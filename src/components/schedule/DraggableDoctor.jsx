import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { User } from 'lucide-react';

export default function DraggableDoctor({ doctor, index, style, isDragDisabled, isBeingDragged }) {
  return (
    <Draggable draggableId={`sidebar-doc-${doctor.id}`} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => {
        const isDragging = snapshot.isDragging;
        // Show compact version when being dragged (from central state) or snapshot says dragging
        const isCompact = isBeingDragged || isDragging;

        const containerStyle = {
          ...provided.draggableProps.style,
          backgroundColor: isCompact ? 'transparent' : (style?.backgroundColor || '#ffffff'),
          color: isCompact ? undefined : (style?.color || '#000000'),
          border: isCompact ? 'none' : undefined,
          boxShadow: isCompact ? 'none' : undefined,
          zIndex: isDragging ? 9999 : 'auto',
          // When compact (dragging), use small dimensions
          width: isCompact ? '60px' : undefined,
          height: isCompact ? '32px' : undefined,
        };

        const containerClass = isCompact 
          ? 'flex items-center justify-center mb-2'
          : 'flex items-center space-x-2 p-2 rounded-md shadow-sm border border-slate-200 hover:opacity-90 transition-colors select-none mb-2 cursor-grab active:cursor-grabbing';

        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={containerClass}
            style={containerStyle}
          >
            {isCompact ? (
              <div 
                className="flex items-center justify-center rounded-md font-bold border shadow-lg ring-2 ring-indigo-400 px-2 py-1 w-full h-full"
                style={{
                  backgroundColor: style?.backgroundColor || '#ffffff',
                  color: style?.color || '#000000',
                }}
              >
                <span className="text-xs">{doctor.initials || doctor.name.substring(0, 3)}</span>
              </div>
            ) : (
              <>
                <div className="flex-shrink-0 font-bold text-xs w-6 h-6 bg-white/50 rounded-full flex items-center justify-center">
                  {doctor.initials || <User size={12} />}
                </div>
                <span className="text-sm font-medium truncate">{doctor.name}</span>
              </>
            )}
          </div>
        );
      }}
    </Draggable>
  );
}