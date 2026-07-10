import { useState, useMemo } from 'react';
import { AlertTriangle, ShieldCheck, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConflictEntry } from '@/components/validation/scanForConflicts';

interface ConflictPanelSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conflicts: ConflictEntry[];
    isScanning: boolean;
    /** Called when user clicks "Resolve" for a specific shift */
    onResolveShift: (shiftId: string) => void;
    /** Map of shiftId -> short label for the "Resolve" button */
    shiftLabels?: Map<string, string>;
}

type SeverityFilter = 'all' | 'blocker' | 'warning';

/**
 * Groups conflicts by date for display.
 */
function groupByDate(conflicts: ConflictEntry[]): Map<string, ConflictEntry[]> {
    const map = new Map<string, ConflictEntry[]>();
    for (const c of conflicts) {
        const existing = map.get(c.dateStr) || [];
        existing.push(c);
        map.set(c.dateStr, existing);
    }
    return map;
}

/**
 * Right-side sheet panel showing all rule conflicts in the current view.
 */
export default function ConflictPanelSheet({
    open,
    onOpenChange,
    conflicts,
    isScanning,
    onResolveShift,
    shiftLabels,
}: ConflictPanelSheetProps) {
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

    const filtered = useMemo(() => {
        if (severityFilter === 'all') return conflicts;
        return conflicts.filter(c => c.severity === severityFilter);
    }, [conflicts, severityFilter]);

    const grouped = useMemo(() => groupByDate(filtered), [filtered]);

    const blockerCount = conflicts.filter(c => c.severity === 'blocker').length;
    const warningCount = conflicts.filter(c => c.severity === 'warning').length;

    const filterLabel = severityFilter === 'all' ? 'Alle' : severityFilter === 'blocker' ? 'Nur Blocker' : 'Nur Warnungen';

    const renderResolveButton = (shiftId: string, label?: string) => {
        if (!shiftId) return null;
        return (
            <Button
                key={shiftId}
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                onClick={() => onResolveShift(shiftId)}
            >
                <Trash2 className="w-3 h-3" />
                {label || 'Entfernen'}
            </Button>
        );
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[420px] sm:max-w-[420px] p-0 flex flex-col">
                <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="flex items-center gap-2 text-base">
                            <ShieldCheck className="w-5 h-5 text-primary" />
                            Regelprüfung
                            {conflicts.length > 0 && (
                                <Badge variant={blockerCount > 0 ? 'destructive' : 'secondary'} className="ml-1">
                                    {conflicts.length}
                                </Badge>
                            )}
                        </SheetTitle>
                    </div>
                </SheetHeader>

                {/* Filter bar */}
                {conflicts.length > 0 && (
                    <div className="px-4 py-2 border-b flex items-center gap-2 flex-shrink-0">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                                    {filterLabel}
                                    {severityFilter !== 'all' && (
                                        <X
                                            className="w-3 h-3 ml-1 cursor-pointer"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSeverityFilter('all');
                                            }}
                                        />
                                    )}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => setSeverityFilter('all')}>
                                    Alle ({conflicts.length})
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSeverityFilter('blocker')}>
                                    <AlertTriangle className="w-3 h-3 mr-1 text-red-500" />
                                    Nur Blocker ({blockerCount})
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSeverityFilter('warning')}>
                                    <AlertTriangle className="w-3 h-3 mr-1 text-yellow-500" />
                                    Nur Warnungen ({warningCount})
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}

                {/* Conflict list */}
                <ScrollArea className="flex-1">
                    <div className="px-4 py-2">
                        {isScanning && (
                            <div className="flex items-center justify-center py-8 text-muted-foreground">
                                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full mr-2" />
                                Prüfe Regeln...
                            </div>
                        )}

                        {!isScanning && filtered.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                                <ShieldCheck className="w-10 h-10 text-green-500" />
                                <p className="text-sm font-medium">Keine Konflikte gefunden</p>
                                <p className="text-xs">Alle Regeln sind erfüllt.</p>
                            </div>
                        )}

                        {!isScanning && [...grouped.entries()].map(([dateStr, dateConflicts]) => (
                            <div key={dateStr} className="mb-4">
                                {/* Date header */}
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 sticky top-0 bg-background py-1">
                                    {new Date(dateStr).toLocaleDateString('de-DE', {
                                        weekday: 'short',
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                    })}
                                </div>

                                {/* Conflict items */}
                                <div className="space-y-2">
                                    {dateConflicts.map((conflict, idx) => (
                                        <div
                                            key={`${conflict.shiftId}-${conflict.ruleId}-${idx}`}
                                            className={cn(
                                                'rounded-lg border p-3 text-sm',
                                                conflict.severity === 'blocker'
                                                    ? 'border-red-200 bg-red-50/50'
                                                    : 'border-yellow-200 bg-yellow-50/50'
                                            )}
                                        >
                                            <div className="flex items-start gap-2">
                                                <AlertTriangle
                                                    className={cn(
                                                        'w-4 h-4 mt-0.5 flex-shrink-0',
                                                        conflict.severity === 'blocker'
                                                            ? 'text-red-500'
                                                            : 'text-yellow-500'
                                                    )}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-medium text-foreground">
                                                            {conflict.doctorName}
                                                        </span>
                                                        <Badge variant="outline" className="text-xs font-normal">
                                                            {conflict.position}
                                                        </Badge>
                                                        {conflict.severity === 'blocker' ? (
                                                            <Badge variant="destructive" className="text-xs">Blocker</Badge>
                                                        ) : (
                                                            <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800">Warnung</Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                                        {conflict.message}
                                                    </p>

                                                    {/* Resolve buttons */}
                                                    {conflict.shiftIds.length > 0 && (
                                                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                            <span className="text-xs text-muted-foreground">Lösen:</span>
                                                            {conflict.shiftIds.map(sid => {
                                                                const label = shiftLabels?.get(sid);
                                                                return renderResolveButton(sid, label);
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
