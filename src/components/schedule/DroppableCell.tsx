import { useEffect, useRef, useState } from 'react';
import type { ReactNode, CSSProperties, MouseEventHandler } from 'react';
import type { RenderCloneProps } from '@hello-pangea/dnd';
import { Droppable } from '@hello-pangea/dnd';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DroppableCellProps {
  id: string;
  isToday: boolean;
  isWeekend: boolean;
  isDisabled: boolean;
  isReadOnly: boolean;
  disabledText?: string | undefined;
  children: ReactNode | ((args: { cellWidth: number | null }) => ReactNode);
  isAlternate: boolean;
  baseClassName?: string | undefined;
  baseStyle?: CSSProperties | undefined;
  isTrainingHighlight: boolean;
  renderClone?: (props: RenderCloneProps, snapshot: unknown) => ReactNode;
  isBlocked: boolean;
  blockReason?: string | undefined;
  onContextMenu?: MouseEventHandler<HTMLDivElement> | undefined;
  isCompact?: boolean;
  testId?: string | undefined;
  infoReason?: string | undefined;
  isOccupied?: boolean | undefined;
}

export default function DroppableCell({ 
    id, isToday, isWeekend, isDisabled, isReadOnly, disabledText, children, 
    isAlternate, baseClassName, baseStyle, isTrainingHighlight, renderClone,
  isBlocked, blockReason, onContextMenu, isCompact = false, testId,
  infoReason, isOccupied
}: DroppableCellProps) {
  const cellRef = useRef<HTMLDivElement | null>(null);
  const [cellWidth, setCellWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = cellRef.current;
    if (!node) return undefined;

    const updateWidth = () => {
      const nextWidth = Math.max(node.clientWidth - 8, 0);
      setCellWidth(prev => (prev === nextWidth ? prev : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const effectiveDisabled = isDisabled || isBlocked;
  const hasInfo = !!infoReason;

  return (
    <Droppable 
      droppableId={id} 
      isDropDisabled={effectiveDisabled || isReadOnly} 
      direction="horizontal"
      renderClone={renderClone}
    >
      {(provided, snapshot) => (
        <div
          ref={(node) => {
            cellRef.current = node;
            provided.innerRef(node);
          }}
          {...provided.droppableProps}
          data-testid={testId}
          onContextMenu={onContextMenu}
          className={`
          ${isCompact ? 'min-h-[38px] p-0.5 gap-0.5' : 'min-h-[60px] p-1 gap-1'} border rounded-sm h-full flex flex-wrap content-start relative will-change-auto
          ${isBlocked ? 'bg-red-50/60 border-red-200 cursor-not-allowed overflow-hidden' : ''}
          ${!isBlocked && hasInfo ? 'bg-blue-50/40 border-blue-200' : ''}
          ${isDisabled && !isBlocked ? 'bg-slate-100/80 border-slate-100 cursor-not-allowed overflow-hidden' : ''}
          ${isTrainingHighlight && !effectiveDisabled ? 'ring-2 ring-amber-400 bg-amber-50 border-amber-300 shadow-inner' : ''}
          ${!effectiveDisabled && snapshot.isDraggingOver ? 'border-indigo-300 ring-2 ring-indigo-300 z-10 transition-none' : (
              !effectiveDisabled && !isTrainingHighlight ? (
                isToday ? 'bg-yellow-50/30 border-x-2 border-x-yellow-400 border-y border-y-slate-100' : (
                    isWeekend ? 'bg-orange-50/50 border-slate-100' : (
                        baseClassName ? `${baseClassName} border-slate-100` : (isAlternate ? 'bg-slate-50/80 border-slate-100' : 'bg-white border-slate-100')
                    )
                )
              ) : (effectiveDisabled ? '' : 'border-slate-100')
          )}
          `}
          style={(!effectiveDisabled && !isToday && !isWeekend && !isTrainingHighlight) ? (baseStyle || {}) : {}}
        >
          {isBlocked && (
              <div className="absolute inset-0 pointer-events-none z-10">
                  <div className="absolute inset-0 opacity-15" style={{
                    backgroundImage: 'repeating-linear-gradient(135deg, #ef4444 0, #ef4444 2px, transparent 2px, transparent 8px)',
                  }}></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                      <span className="bg-red-100/90 px-2 py-0.5 rounded shadow-sm text-xs text-red-700 font-medium max-w-full truncate">
                        🔒 {blockReason || 'Gesperrt'}
                      </span>
                  </div>
              </div>
          )}
          {isDisabled && !isBlocked && (
              <div className="absolute inset-0 pointer-events-none z-10">
                  <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:8px_8px]"></div>
                  {disabledText && (
                      <div className="absolute inset-0 flex items-center justify-center">
                          <span className="bg-white/80 px-2 py-1 rounded-full shadow-sm text-xs text-slate-400">{disabledText}</span>
                      </div>
                  )}
              </div>
          )}
          {typeof children === 'function' ? children({ cellWidth }) : children}
          {/* Always hide placeholder to prevent layout shift */}
          <div style={{ display: 'none' }}>{provided.placeholder}</div>

          {/* Info indicator — empty cell: blue hatched overlay with text; occupied cell: badge + tooltip */}
          {hasInfo && !isBlocked && !isOccupied && (
            <div className="absolute inset-0 pointer-events-none z-10">
              <div className="absolute inset-0 opacity-15" style={{
                backgroundImage: 'repeating-linear-gradient(135deg, #3b82f6 0, #3b82f6 2px, transparent 2px, transparent 8px)',
              }}></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-blue-100/90 px-2 py-0.5 rounded shadow-sm text-xs text-blue-700 font-medium max-w-full truncate">
                  ℹ️ {infoReason}
                </span>
              </div>
            </div>
          )}
          {hasInfo && !isBlocked && isOccupied && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute top-0.5 right-0.5 z-20 cursor-help">
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-blue-400 text-white text-[10px] font-bold shadow-sm">
                      i
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[250px] text-xs bg-blue-900 text-white border-blue-700 shadow-lg">
                  <p>{infoReason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </Droppable>
  );
}
