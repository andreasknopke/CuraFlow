import React, { useRef, useEffect, useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';

export default function DraggableShift({ shift, doctor, index, onRemove, isFullWidth, isDragDisabled, fontSize = 14, boxSize = 48, currentUserDoctorId, highlightMyName = true, ...props }) {
  const isPreview = shift.isPreview;
  const isCurrentUser = currentUserDoctorId && doctor.id === currentUserDoctorId;
  const containerRef = useRef(null);
  const [displayText, setDisplayText] = useState(isFullWidth ? doctor.name : doctor.initials);
  const [displayFontSize, setDisplayFontSize] = useState(fontSize);
  
  // Measure and adjust text to fit container
  const measureAndAdjust = React.useCallback(() => {
    if (!isFullWidth) {
      setDisplayText(doctor.initials || doctor.name.substring(0, 3));
      setDisplayFontSize(fontSize);
      return;
    }
    
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const availableWidth = container.offsetWidth - 8; // 8px padding
    
    if (availableWidth <= 20) return; // Not yet rendered properly
    
    // Create temporary span to measure text
    const measureSpan = document.createElement('span');
    measureSpan.style.visibility = 'hidden';
    measureSpan.style.position = 'absolute';
    measureSpan.style.whiteSpace = 'nowrap';
    measureSpan.style.fontWeight = 'bold';
    document.body.appendChild(measureSpan);
    
    const name = doctor.name;
    const initials = doctor.initials || name.substring(0, 3);
    
    // Try full name at normal size
    measureSpan.style.fontSize = `${fontSize}px`;
    measureSpan.textContent = name;
    
    if (measureSpan.offsetWidth <= availableWidth) {
      setDisplayText(name);
      setDisplayFontSize(fontSize);
      document.body.removeChild(measureSpan);
      return;
    }
    
    // Try full name at smaller size (min 10px)
    const smallerSize = Math.max(fontSize * 0.8, 10);
    measureSpan.style.fontSize = `${smallerSize}px`;
    
    if (measureSpan.offsetWidth <= availableWidth) {
      setDisplayText(name);
      setDisplayFontSize(smallerSize);
      document.body.removeChild(measureSpan);
      return;
    }
    
    // Use initials at normal size
    setDisplayText(initials);
    setDisplayFontSize(fontSize);
    
    document.body.removeChild(measureSpan);
  }, [isFullWidth, doctor.name, doctor.initials, fontSize]);

  // Use ResizeObserver to detect actual container size changes
  useEffect(() => {
    measureAndAdjust();
    
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver(() => {
      measureAndAdjust();
    });
    
    observer.observe(containerRef.current);
    
    return () => observer.disconnect();
  }, [measureAndAdjust]);
  
  const dynamicStyle = {
      fontSize: `${fontSize}px`,
      ...(isFullWidth 
          ? { width: '100%', height: '100%', minHeight: `${boxSize * 0.8}px` } 
          : { width: `${boxSize}px`, height: `${boxSize}px` }
      )
  };

  return (
    <Draggable draggableId={`shift-${shift.id}`} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => {
        // When dragging, use compact dimensions to fix cursor offset issue.
        // The drag clone should be small so its center aligns with cursor.

        const isDragging = snapshot.isDragging;

        // Style for the outer container (the "Ghost")
        // If dragging: compact size for better cursor alignment
        // If not dragging: use dynamicStyle and normal colors
        const containerStyle = isDragging ? {
             ...provided.draggableProps.style,
             backgroundColor: 'transparent',
             border: 'none',
             boxShadow: 'none',
             zIndex: 9999,
             cursor: 'none',
             width: '60px',  // Compact width for better cursor alignment
             height: '32px',
        } : {
             ...provided.draggableProps.style,
             ...dynamicStyle, // Apply normal layout dimensions
             backgroundColor: props.style?.backgroundColor || '#f1f5f9',
             color: props.style?.color || '#0f172a',
             zIndex: 'auto'
        };

        const containerClass = isDragging 
            ? `flex items-center justify-center cursor-none` // Center the badge
            : `flex items-center justify-center rounded-md font-bold border shadow-sm hover:opacity-80 ${isPreview ? 'ring-2 ring-indigo-500 ring-offset-1 opacity-90' : ''} ${!isDragging && isCurrentUser && highlightMyName ? 'ring-2 ring-red-500 ring-offset-1 z-10' : ''} cursor-grab active:cursor-grabbing`;

        return (
          <div
            ref={(el) => {
              provided.innerRef(el);
              containerRef.current = el;
            }}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={containerClass}
            style={containerStyle}
          >
            {isDragging ? (
                // The visual badge
                <div className={`
                    flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400 px-2 py-1 z-[9999]
                `}
                style={{
                    backgroundColor: props.style?.backgroundColor || '#f1f5f9',
                    color: props.style?.color || '#0f172a',
                    minWidth: '40px',
                }}
                >
                    <span className="truncate" style={{ fontSize: `${fontSize}px` }}>
                       {doctor.initials || doctor.name.substring(0,3)}
                    </span>
                </div>
            ) : (
                <span 
                    className="truncate px-0.5 leading-tight text-center w-full" 
                    style={{ fontSize: `${displayFontSize}px` }}
                >
                    {displayText}
                </span>
            )}
          </div>
        );
      }}
    </Draggable>
  );
}