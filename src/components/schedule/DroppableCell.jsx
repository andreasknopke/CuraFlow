import React from 'react';
import { Droppable } from '@hello-pangea/dnd';

export default function DroppableCell({ 
    id, isToday, isWeekend, isDisabled, isReadOnly, disabledText, children, 
    isAlternate, baseClassName, baseStyle, isTrainingHighlight, renderClone
}) {
  return (
    <Droppable 
      droppableId={id} 
      isDropDisabled={isDisabled || isReadOnly} 
      direction="horizontal"
      renderClone={renderClone}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`
          min-h-[60px] p-1 border rounded-sm h-full flex flex-wrap content-start gap-1 relative will-change-auto
          ${isDisabled ? 'bg-slate-100/80 border-slate-100 cursor-not-allowed overflow-hidden' : ''}
          ${isTrainingHighlight && !isDisabled ? 'ring-2 ring-amber-400 bg-amber-50 border-amber-300 shadow-inner' : ''}
          ${!isDisabled && snapshot.isDraggingOver ? 'border-indigo-300 ring-2 ring-indigo-300 z-10 transition-none' : (
              !isDisabled && !isTrainingHighlight ? (
                isToday ? 'bg-yellow-50/30 border-x-2 border-yellow-400 border-y border-slate-100' : (
                    isWeekend ? 'bg-orange-50/50 border-slate-100' : (
                        baseClassName ? `${baseClassName} border-slate-100` : (isAlternate ? 'bg-slate-50/80 border-slate-100' : 'bg-white border-slate-100')
                    )
                )
              ) : (isDisabled ? '' : 'border-slate-100')
          )}
          `}
          style={(!isDisabled && !isToday && !isWeekend && !isTrainingHighlight) ? (baseStyle || {}) : {}}
        >
          {isDisabled && (
              <div className="absolute inset-0 pointer-events-none z-10">
                  <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:8px_8px]"></div>
                  {disabledText && (
                      <div className="absolute inset-0 flex items-center justify-center">
                          <span className="bg-white/80 px-2 py-1 rounded-full shadow-sm text-xs text-slate-400">{disabledText}</span>
                      </div>
                  )}
              </div>
          )}
          {children}
          {/* Always hide placeholder to prevent layout shift */}
          <div style={{ display: 'none' }}>{provided.placeholder}</div>
        </div>
      )}
    </Droppable>
  );
}