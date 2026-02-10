import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';
import { useAuth } from '@/components/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format, subDays } from 'date-fns';
import { Loader2, RefreshCw, Search, FileText, Info, AlertTriangle, CheckCircle, XCircle, Filter, Calendar, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

export default function SystemLogs() {
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedLog, setSelectedLog] = useState(null);
    const [filterLevel, setFilterLevel] = useState("ALL"); // ALL, error, info, wish_request, override, audit
    const [dateFrom, setDateFrom] = useState(null);
    const [dateTo, setDateTo] = useState(null);

    // Helper to call backend with JWT token
    const invokeWithAuth = async (action, data = {}) => {
        const response = await fetch(`${window.location.origin}/api/functions/adminTools`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action, ...data })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Fehler bei der Anfrage');
        }
        return { data: result };
    };

    const { data: logs = [], isLoading, refetch } = useQuery({
        queryKey: ['systemLogs'],
        queryFn: () => db.SystemLog.list({ sort: '-created_date', limit: 500 }),
        staleTime: 2 * 60 * 1000, // 2 Minuten
        cacheTime: 5 * 60 * 1000, // 5 Minuten
        refetchOnWindowFocus: false,
    });

    const deleteOldLogsMutation = useMutation({
        mutationFn: (days) => invokeWithAuth('delete_old_logs', { days }),
        onSuccess: (res) => {
            toast.success(res.data.message);
            queryClient.invalidateQueries(['systemLogs']);
        },
        onError: (err) => toast.error("Fehler: " + err.message)
    });

    const getLevelIcon = (level) => {
        switch (level) {
            case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
            case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
            case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'wish_request': return <FileText className="w-4 h-4 text-purple-500" />;
            case 'override': return <AlertTriangle className="w-4 h-4 text-orange-500" />;
            case 'audit': return <Trash2 className="w-4 h-4 text-rose-600" />;
            default: return <Info className="w-4 h-4 text-blue-500" />;
        }
    };

    const getLevelBadge = (level) => {
        switch (level) {
            case 'error': return 'bg-red-100 text-red-700 border-red-200';
            case 'warning': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'success': return 'bg-green-100 text-green-700 border-green-200';
            case 'wish_request': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'override': return 'bg-orange-100 text-orange-700 border-orange-200';
            case 'audit': return 'bg-rose-100 text-rose-700 border-rose-200';
            default: return 'bg-blue-100 text-blue-700 border-blue-200';
        }
    };

    const filteredLogs = logs.filter(log => {
        const matchesSearch = log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
                              log.source.toLowerCase().includes(searchTerm.toLowerCase());
        
        if (!matchesSearch) return false;

        // Date filter
        const logDate = new Date(log.created_date);
        if (dateFrom && logDate < new Date(dateFrom.setHours(0, 0, 0, 0))) return false;
        if (dateTo && logDate > new Date(dateTo.setHours(23, 59, 59, 999))) return false;

        if (filterLevel === 'ALL') return true;
        if (filterLevel === 'wish_request') return log.level === 'wish_request';
        if (filterLevel === 'error') return log.level === 'error';
        if (filterLevel === 'info') return log.level === 'info';
        if (filterLevel === 'override') return log.level === 'override';
        if (filterLevel === 'audit') return log.level === 'audit';
        
        return true;
    });

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="w-5 h-5" /> System-Logs
                        </CardTitle>
                        <CardDescription>Protokoll der Systemereignisse und Backups</CardDescription>
                    </div>
                    <Button variant="outline" size="icon" onClick={() => refetch()}>
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
                <div className="pt-4">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
                        <Input
                            placeholder="Suche in Logs..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                         <Select value={filterLevel} onValueChange={setFilterLevel}>
                            <SelectTrigger className="w-[180px]">
                                <Filter className="w-4 h-4 mr-2 text-slate-500" />
                                <SelectValue placeholder="Filter" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">Alle Einträge</SelectItem>
                                <SelectItem value="error">Nur Fehler</SelectItem>
                                <SelectItem value="info">Nur Infos</SelectItem>
                                <SelectItem value="wish_request">Dienstwünsche</SelectItem>
                                <SelectItem value="override">Overrides</SelectItem>
                                <SelectItem value="audit">Audit / Löschungen</SelectItem>
                            </SelectContent>
                        </Select>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-[180px] justify-start">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {dateFrom ? format(dateFrom, 'dd.MM.yyyy') : 'Von Datum'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <CalendarComponent
                                    mode="single"
                                    selected={dateFrom}
                                    onSelect={setDateFrom}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-[180px] justify-start">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {dateTo ? format(dateTo, 'dd.MM.yyyy') : 'Bis Datum'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <CalendarComponent
                                    mode="single"
                                    selected={dateTo}
                                    onSelect={setDateTo}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>

                        {(dateFrom || dateTo) && (
                            <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => { setDateFrom(null); setDateTo(null); }}
                            >
                                Filter zurücksetzen
                            </Button>
                        )}

                        <div className="flex-1" />

                        <Select onValueChange={(value) => {
                            if (confirm(`Alle Logs älter als ${value} Tage wirklich löschen?`)) {
                                deleteOldLogsMutation.mutate(parseInt(value));
                            }
                        }}>
                            <SelectTrigger className="w-[200px]">
                                <Trash2 className="w-4 h-4 mr-2 text-slate-500" />
                                <SelectValue placeholder="Alte Logs löschen..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7">Älter als 7 Tage</SelectItem>
                                <SelectItem value="14">Älter als 14 Tage</SelectItem>
                                <SelectItem value="30">Älter als 30 Tage</SelectItem>
                                <SelectItem value="60">Älter als 60 Tage</SelectItem>
                                <SelectItem value="90">Älter als 90 Tage</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Zeitstempel</TableHead>
                                <TableHead className="w-[120px]">Level</TableHead>
                                <TableHead className="w-[150px]">Quelle</TableHead>
                                <TableHead>Nachricht</TableHead>
                                <TableHead className="w-[80px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center h-24">
                                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                                    </TableCell>
                                </TableRow>
                            ) : filteredLogs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center h-24 text-slate-500">
                                        Keine Einträge gefunden
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredLogs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell className="font-mono text-xs">
                                            {format(new Date(log.created_date), 'dd.MM.yyyy HH:mm:ss')}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`${getLevelBadge(log.level)} flex w-fit items-center gap-1`}>
                                                {getLevelIcon(log.level)}
                                                <span className="capitalize">{log.level}</span>
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-medium text-slate-700">
                                            {log.source}
                                        </TableCell>
                                        <TableCell>
                                            <div className="truncate max-w-[400px]" title={log.message}>
                                                {log.message}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {log.details && (
                                                <Dialog>
                                                    <DialogTrigger asChild>
                                                        <Button variant="ghost" size="sm">Details</Button>
                                                    </DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader>
                                                            <DialogTitle>Log Details</DialogTitle>
                                                            <DialogDescription>
                                                                {format(new Date(log.created_date), 'PPpp')} - {log.source}
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <ScrollArea className="h-[300px] w-full rounded-md border p-4 bg-slate-50 font-mono text-xs">
                                                            <pre className="whitespace-pre-wrap break-words">
                                                                {(() => {
                                                                    try {
                                                                        return JSON.stringify(JSON.parse(log.details), null, 2);
                                                                    } catch (e) {
                                                                        return log.details;
                                                                    }
                                                                })()}
                                                            </pre>
                                                        </ScrollArea>
                                                    </DialogContent>
                                                </Dialog>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}