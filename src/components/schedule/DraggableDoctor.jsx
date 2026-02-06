import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { User } from 'lucide-react';

export default function DraggableDoctor({ doctor, index, style, isDragDisabled }) {
  return (
    <Draggable draggableId={`sidebar-doc-${doctor.id}`} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => {
        const isDragging = snapshot.isDragging;

        // When dragging: use compact dimensions to fix cursor offset issue
        // The drag clone should be small so its center aligns with cursor
        const containerStyle = isDragging ? {
          ...provided.draggableProps.style,
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          zIndex: 9999,
          width: '60px',  // Compact width for better cursor alignment
          height: '32px',
        } : {
          ...provided.draggableProps.style,
          backgroundColor: style?.backgroundColor || '#ffffff',
          color: style?.color || '#000000',
        };

        const containerClass = isDragging 
          ? 'flex items-center justify-center'
          : 'flex items-center space-x-2 p-2 rounded-md shadow-sm border border-slate-200 hover:opacity-90 transition-colors select-none mb-2 cursor-grab active:cursor-grabbing';

        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={containerClass}
            style={containerStyle}
          >
            {isDragging ? (
              <div 
                className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400 px-2 py-1"
                style={{
                  backgroundColor: style?.backgroundColor || '#ffffff',
                  color: style?.color || '#000000',
                  minWidth: '40px',
                  zIndex: 9999,
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