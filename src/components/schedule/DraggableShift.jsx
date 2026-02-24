import React from 'react';
import { Draggable } from '@hello-pangea/dnd';

export default function DraggableShift({ shift, doctor, index, onRemove, isFullWidth, isDragDisabled, fontSize = 14, boxSize = 48, currentUserDoctorId, highlightMyName = true, isBeingDragged = false, qualificationStatus = null, fairnessInfo = null, draggableIdPrefix = '', ...props }) {
  const isPreview = shift.isPreview;
  const isCurrentUser = currentUserDoctorId && doctor.id === currentUserDoctorId;
  const displayText = isFullWidth ? doctor.name : (doctor.initials || doctor.name.substring(0, 3));
  const displayFontSize = fontSize;

  // Build fairness tooltip text for preview service shifts
  const fairnessTooltip = React.useMemo(() => {
    if (!fairnessInfo) return null;
    const lines = [`Dienste (4 Wo. + Vorschläge): ${fairnessInfo.total}`];
    if (fairnessInfo.fg > 0 || fairnessInfo.bg > 0) {
      lines.push(`  VG: ${fairnessInfo.fg} | HG: ${fairnessInfo.bg}`);
    }
    lines.push(`Wochenende: ${fairnessInfo.weekend}`);
    if (fairnessInfo.wishText) {
      lines.push(fairnessInfo.wishText);
    }
    return lines.join('\n');
  }, [fairnessInfo]);
  
  // Qualification warning/error indicator
  const QualWarning = qualificationStatus === 'excluded' ? (
    <div 
      className="absolute -top-0.5 -right-0.5 z-20 text-red-600"
      style={{ fontSize: Math.max(fontSize * 0.7, 8) }}
      title="NOT-Qualifikation: Arzt darf hier nicht eingeteilt werden!"
    >
      ⊘
    </div>
  ) : qualificationStatus === 'unqualified' ? (
    <div 
      className="absolute -top-0.5 -right-0.5 z-20 text-amber-600"
      style={{ fontSize: Math.max(fontSize * 0.7, 8) }}
      title="Fehlende Pflicht-Qualifikation (Override)"
    >
      ⚠
    </div>
  ) : null;

  const dynamicStyle = {
      fontSize: `${fontSize}px`,
      ...(isFullWidth 
          ? { width: '100%', height: '100%', minHeight: `${boxSize * 0.8}px` } 
          : { width: `${boxSize}px`, height: `${boxSize}px` }
      )
  };

  // When isBeingDragged (from central state) - compact dimensions for correct measurement
  // This runs BEFORE react-beautiful-dnd measures the element
  if (isBeingDragged) {
    return (
      <Draggable draggableId={`${draggableIdPrefix}shift-${shift.id}`} index={index} isDragDisabled={isDragDisabled}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className="flex items-center justify-center"
            style={{
              ...provided.draggableProps.style,
              backgroundColor: 'transparent',
              border: 'none',
              boxShadow: 'none',
              width: `${boxSize}px`,
              height: `${boxSize}px`,
              zIndex: 9999,
            }}
          >
            <div 
              className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
              style={{
                backgroundColor: props.style?.backgroundColor || '#f1f5f9',
                color: props.style?.color || '#0f172a',
                width: `${boxSize}px`,
                height: `${boxSize}px`,
                fontSize: `${fontSize}px`,
              }}
            >
              <span>{doctor.initials || doctor.name.substring(0, 3)}</span>
            </div>
          </div>
        )}
      </Draggable>
    );
  }

  return (
    <Draggable draggableId={`${draggableIdPrefix}shift-${shift.id}`} index={index} isDragDisabled={isDragDisabled}>
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
             width: `${boxSize}px`,
             height: `${boxSize}px`,
        } : {
             ...provided.draggableProps.style,
             ...dynamicStyle, // Apply normal layout dimensions
             backgroundColor: props.style?.backgroundColor || '#f1f5f9',
             color: props.style?.color || '#0f172a',
             zIndex: 'auto'
        };

        const containerClass = isDragging 
            ? `flex items-center justify-center cursor-none` // Center the badge
          : `relative flex items-center ${isFullWidth ? 'justify-start overflow-hidden' : 'justify-center'} rounded-md font-bold border shadow-sm transition-colors ${isPreview ? 'opacity-50 border-dashed border-indigo-400 cursor-grab hover:opacity-80 hover:border-indigo-600' : ''} ${!isDragging && isCurrentUser && highlightMyName ? 'ring-2 ring-red-500 ring-offset-1 z-10' : ''} ${isFullWidth ? '' : 'cursor-grab active:cursor-grabbing'}`;

        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...(isFullWidth ? {} : provided.dragHandleProps)}
            className={containerClass}
            style={containerStyle}
            title={fairnessTooltip || (isPreview ? 'Vorschlag — per Drag & Drop verschieben' : undefined)}
          >
            {isDragging ? (
                // The visual badge - square like small chips
                <div className={`
                    flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400 z-[9999]
                `}
                style={{
                    backgroundColor: props.style?.backgroundColor || '#f1f5f9',
                    color: props.style?.color || '#0f172a',
                    width: `${boxSize}px`,
                    height: `${boxSize}px`,
                    fontSize: `${fontSize}px`,
                }}
                >
                    <span className="truncate">
                       {doctor.initials || doctor.name.substring(0,3)}
                    </span>
                </div>
            ) : isFullWidth ? (
                <>
                    {QualWarning}
                    <div 
                        {...provided.dragHandleProps}
                        className="flex-shrink-0 font-bold flex items-center justify-center cursor-grab active:cursor-grabbing rounded-l-md h-full bg-white/50 hover:bg-black/10 transition-colors"
                        style={{ width: `${boxSize}px`, fontSize: `${fontSize}px` }}
                        title={fairnessTooltip || "Ziehen zum Verschieben"}
                    >
                        {doctor.initials || doctor.name.substring(0, 3)}
                    </div>
                    <span 
                      className="block min-w-0 basis-0 flex-1 truncate px-1 leading-tight text-center" 
                        style={{ fontSize: `${displayFontSize}px` }}
                    >
                        {displayText}
                    </span>
                    {fairnessInfo && (
                        <span
                            className="flex-shrink-0 rounded px-1 text-white font-semibold mr-1"
                            style={{ fontSize: `${Math.max(fontSize * 0.65, 8)}px`, backgroundColor: fairnessInfo.total >= 4 ? '#ef4444' : fairnessInfo.total >= 2 ? '#f59e0b' : '#22c55e', lineHeight: '1.4' }}
                            title={fairnessTooltip}
                        >
                            {fairnessInfo.total}D{fairnessInfo.weekend > 0 ? ` ${fairnessInfo.weekend}W` : ''}{fairnessInfo.wishText ? ' ★' : ''}
                        </span>
                    )}
                </>
            ) : (
                <div className="absolute inset-0 rounded-md bg-white/50 hover:bg-black/10 transition-colors z-0" />
            )}
            {!isDragging && !isFullWidth && (
                <>
                {QualWarning}
                <span 
                    className="truncate px-0.5 leading-tight text-center w-full relative z-10" 
                    style={{ fontSize: `${displayFontSize}px` }}
                >
                    {displayText}
                </span>
                {fairnessInfo && (
                    <div
                        className="absolute -bottom-1 -right-1 z-20 rounded-full px-1 text-white font-bold leading-none"
                        style={{ fontSize: `${Math.max(fontSize * 0.55, 7)}px`, backgroundColor: fairnessInfo.total >= 4 ? '#ef4444' : fairnessInfo.total >= 2 ? '#f59e0b' : '#22c55e', padding: '1px 3px' }}
                        title={fairnessTooltip}
                    >
                        {fairnessInfo.total}
                    </div>
                )}
                </>
            )}
          </div>
        );
      }}
    </Draggable>
  );
}