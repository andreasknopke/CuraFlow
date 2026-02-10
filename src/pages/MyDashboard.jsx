import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { format, isAfter, parseISO, startOfDay, addMonths, isSameDay, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import WishReminderStatus from '@/components/wishlist/WishReminderStatus';
import { LayoutDashboard, CalendarDays, User, Clock, AlertCircle, CheckCircle2, XCircle, Loader2, Check, X, ClipboardList, Mail, Trash2, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from "@/components/ui/use-toast";

// Safe parseISO that handles undefined/null
const safeParseISO = (dateStr) => {
    if (!dateStr) return null;
    try {
        const d = parseISO(dateStr);
        return isValid(d) ? d : null;
    } catch (e) {
        return null;
    }
};

// Safe date formatting
const safeFormatDate = (dateStr, formatStr, options = {}) => {
    const d = safeParseISO(dateStr);
    if (!d) return '-';
    try {
        return format(d, formatStr, options);
    } catch (e) {
        return '-';
    }
};

// Admin Tasks Component with "show more" functionality
function AdminTasksSection({ allPendingWishes, isLoadingPending, doctors, handleQuickDecision, silentDeleteWishMutation, isUpdating }) {
    const [showAll, setShowAll] = useState(false);
    const MAX_VISIBLE = 6;
    
    const visibleWishes = showAll ? allPendingWishes : allPendingWishes.slice(0, MAX_VISIBLE);
    const hasMore = allPendingWishes.length > MAX_VISIBLE;

    return (
        <Card className="border-indigo-100 shadow-md">
            <CardHeader className="pb-3 bg-indigo-50/50 rounded-t-lg">
                <CardTitle className="flex items-center gap-2 text-indigo-900">
                    <ClipboardList className="w-5 h-5 text-indigo-600" />
                    Meine Aufgaben
                    {allPendingWishes.length > 0 && (
                        <Badge variant="secondary" className="ml-2 bg-indigo-100 text-indigo-700">
                            {allPendingWishes.length}
                        </Badge>
                    )}
                </CardTitle>
                <CardDescription>Offene Entscheidungen und Genehmigungen</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
                {isLoadingPending ? (
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin text-indigo-400" /></div>
                ) : allPendingWishes.length === 0 ? (
                    <div className="flex items-center justify-center p-8 text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                        <CheckCircle2 className="w-5 h-5 mr-2 text-green-500" />
                        Alles erledigt! Keine offenen Aufgaben.
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                            {visibleWishes.map(wish => {
                                let doc = doctors.find(d => d.id === wish.doctor_id);
                                if (!doc && wish.doctor_id) {
                                    doc = doctors.find(d => String(d.id) === String(wish.doctor_id));
                                }
                                return (
                                    <div key={wish.id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between gap-2 min-w-0">
                                        <div>
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-semibold text-slate-800 truncate pr-2">
                                                    {doc?.name || 'Unbekannte Person'}
                                                </span>
                                                <Badge variant="outline" className={wish.priority === 'high' ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-50 text-slate-600"}>
                                                    {wish.priority === 'high' ? 'Hohe Prio' : 'Normal'}
                                                </Badge>
                                            </div>
                                            
                                            {wish.status === 'cancellation_requested' && (
                                                <div className="bg-red-50 border border-red-100 text-red-700 text-xs p-2 rounded mb-2 font-medium">
                                                    ⚠️ Möchte stornieren
                                                </div>
                                            )}

                                            <div className="text-sm text-slate-600 mb-2">
                                                <span className="font-medium">{safeFormatDate(wish.date, 'dd.MM.yyyy') || 'Datum ungültig'}</span>
                                                <span className="mx-1">•</span>
                                                <span className={wish.type === 'service' ? "text-green-600" : "text-red-600"}>
                                                    {wish.type === 'service' ? (wish.position ? `Dienst: ${wish.position}` : 'Dienstwunsch') : 'Kein Dienst'}
                                                </span>
                                            </div>
                                            {wish.reason && (
                                                <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded italic mb-2">
                                                    "{wish.reason}"
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-1.5 mt-auto pt-2 border-t border-slate-100">
                                            {wish.status === 'cancellation_requested' ? (
                                                <>
                                                    <Button 
                                                        size="sm" 
                                                        className="flex-1 min-w-[80px] bg-red-600 hover:bg-red-700 text-white h-8 text-xs"
                                                        onClick={() => handleQuickDecision(wish, 'approve_cancellation')}
                                                        disabled={isUpdating}
                                                    >
                                                        <Check className="w-3 h-3 mr-1" /> OK
                                                    </Button>
                                                    <Button 
                                                        size="sm" 
                                                        variant="outline" 
                                                        className="flex-1 min-w-[80px] h-8 text-xs"
                                                        onClick={() => handleQuickDecision(wish, 'reject_cancellation')}
                                                        disabled={isUpdating}
                                                    >
                                                        <X className="w-3 h-3 mr-1" /> Behalten
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button 
                                                        size="sm" 
                                                        className="flex-1 min-w-[70px] bg-green-600 hover:bg-green-700 text-white h-8 text-xs px-2"
                                                        onClick={() => handleQuickDecision(wish, 'approved')}
                                                        disabled={isUpdating}
                                                    >
                                                        <Check className="w-3 h-3 mr-0.5" /> OK
                                                    </Button>
                                                    <Button 
                                                        size="sm" 
                                                        variant="destructive" 
                                                        className="flex-1 min-w-[70px] h-8 text-xs px-2"
                                                        onClick={() => handleQuickDecision(wish, 'rejected')}
                                                        disabled={isUpdating}
                                                    >
                                                        <X className="w-3 h-3 mr-0.5" /> Nein
                                                    </Button>
                                                    <Button 
                                                        size="sm" 
                                                        variant="ghost" 
                                                        className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                                                        onClick={() => {
                                                            if (confirm(`Wunsch löschen ohne Benachrichtigung?`)) {
                                                                silentDeleteWishMutation.mutate(wish.id);
                                                            }
                                                        }}
                                                        disabled={isUpdating}
                                                        title="Ohne Genehmigung löschen"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {hasMore && (
                            <div className="mt-4 flex justify-center">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowAll(!showAll)}
                                    className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                >
                                    {showAll ? (
                                        <>Weniger anzeigen</>
                                    ) : (
                                        <>
                                            <ChevronDown className="w-4 h-4 mr-1" />
                                            {allPendingWishes.length - MAX_VISIBLE} weitere anzeigen
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

export default function MyDashboardPage() {
    const { user, isAuthenticated } = useAuth();
    const { toast } = useToast();
    const [selectedDoctorId, setSelectedDoctorId] = useState(null);

    // Fetch all doctors for admin selection or to resolve current user's doctor
    const { data: doctors = [], isLoading: isLoadingDocs } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
    });

    // Determine initial doctor selection
    useEffect(() => {
        if (doctors.length > 0 && user && !selectedDoctorId) {
            // Admins: prefer user.doctor_id, otherwise first doctor
            // Non-Admins: only their assigned doctor
            if (user.role === 'admin') {
                if (user.doctor_id && doctors.some(d => d.id === user.doctor_id)) {
                    setSelectedDoctorId(user.doctor_id);
                } else {
                    setSelectedDoctorId(doctors[0].id);
                }
            } else {
                if (user.doctor_id && doctors.some(d => d.id === user.doctor_id)) {
                    setSelectedDoctorId(user.doctor_id);
                }
                // If no doctor_id for non-admin, selectedDoctorId stays null
            }
        }
    }, [doctors, user, selectedDoctorId]);

    // Fetch data for selected doctor
    const { data: shifts = [], isLoading: isLoadingShifts } = useQuery({
        queryKey: ['shifts', selectedDoctorId],
        queryFn: async () => {
            if (!selectedDoctorId) return [];
            const today = format(startOfDay(new Date()), 'yyyy-MM-dd');
            const nextYear = format(addMonths(new Date(), 12), 'yyyy-MM-dd');
            return db.ShiftEntry.filter({
                doctor_id: selectedDoctorId,
                date: { $gte: today, $lte: nextYear }
            }, 'date', 100); // Get next 100 shifts sorted by date
        },
        enabled: !!selectedDoctorId
    });

    const { data: wishes = [], isLoading: isLoadingWishes } = useQuery({
        queryKey: ['wishes', selectedDoctorId],
        queryFn: async () => {
            if (!selectedDoctorId) return [];
            const today = format(startOfDay(new Date()), 'yyyy-MM-dd');
            return db.WishRequest.filter({
                doctor_id: selectedDoctorId,
                date: { $gte: today }
            }, 'date', 50);
        },
        enabled: !!selectedDoctorId
    });

    // User: Fetch Shift Notifications
    const { data: notifications = [], isLoading: isLoadingNotifications } = useQuery({
        queryKey: ['shiftNotifications', selectedDoctorId],
        queryFn: async () => {
            if (!selectedDoctorId) return [];
            // Only fetch unacknowledged ones (limit increased to avoid "hidden" items issue, though UI will scroll)
            return db.ShiftNotification.filter({
                doctor_id: selectedDoctorId,
                acknowledged: false
            }, 'date', 50);
        },
        enabled: !!selectedDoctorId
    });

    const acknowledgeNotificationMutation = useMutation({
        mutationFn: (id) => db.ShiftNotification.update(id, { acknowledged: true }),
        onSuccess: () => queryClient.invalidateQueries(['shiftNotifications'])
    });

    const bulkAcknowledgeMutation = useMutation({
        mutationFn: async () => {
            if (!selectedDoctorId) return;
            // Fetch ALL unacknowledged notifications to ensure complete cleanup
            const allUnack = await db.ShiftNotification.filter({
                doctor_id: selectedDoctorId,
                acknowledged: false
            }, null, 1000); // High limit to get everything
            
            if (allUnack.length > 0) {
                await Promise.all(allUnack.map(n => db.ShiftNotification.update(n.id, { acknowledged: true })));
            }
        },
        onSuccess: () => queryClient.invalidateQueries(['shiftNotifications'])
    });

    const updateDoctorMutation = useMutation({
        mutationFn: (data) => db.Doctor.update(selectedDoctorId, data),
        onSuccess: () => queryClient.invalidateQueries(['doctors'])
    });

    const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);
    const isAdmin = user?.role === 'admin';

    // Admin: Fetch all pending wishes (including cancellation requests)
    const { data: allPendingWishes = [], isLoading: isLoadingPending } = useQuery({
        queryKey: ['allPendingWishes'],
        queryFn: async () => {
            const pending = await db.WishRequest.filter({ status: 'pending' });
            const cancellation = await db.WishRequest.filter({ status: 'cancellation_requested' });
            return [...pending, ...cancellation];
        },
        enabled: isAdmin
    });

    // CRITICAL: Must be defined BEFORE mutations that use it
    const queryClient = useQueryClient();

    // Mark unviewed items as viewed when user visits dashboard
    useEffect(() => {
        if (isAuthenticated && !isAdmin && user?.doctor_id) {
            db.WishRequest.filter({ doctor_id: user.doctor_id, user_viewed: false })
                .then(unviewed => {
                    if (unviewed.length > 0) {
                        Promise.all(unviewed.map(w => db.WishRequest.update(w.id, { user_viewed: true })))
                            .then(() => {
                                queryClient.invalidateQueries(['wishes']);
                                queryClient.invalidateQueries(['dashboardAlert']);
                            });
                    }
                });
        }
    }, [isAuthenticated, isAdmin, user]);

    // Helper for Auto-Off logic (simplified version of what's in ScheduleBoard)
    const handleAutoShiftCreation = async (wish, dateStr) => {
        if (wish.type !== 'service' || !wish.position) return;

        // 1. Create the shift
        // Check if shift already exists to avoid duplicates? 
        // The wish approval implies we want to enforce this shift.
        const existingShifts = await db.ShiftEntry.filter({ date: dateStr, doctor_id: wish.doctor_id });
        const conflict = existingShifts.find(s => s.position === wish.position);
        if (conflict) return; // Already exists

        await db.ShiftEntry.create({
            date: dateStr,
            position: wish.position,
            doctor_id: wish.doctor_id,
            note: 'Durch Wunschgenehmigung erstellt'
        });

        // 2. Check for Auto-Off
        // We need workplace config for this.
        const workplaces = await db.Workplace.list();
        const wp = workplaces.find(w => w.name === wish.position);
        
        if (wp?.auto_off) {
            const currentDate = new Date(dateStr);
            if (!isValid(currentDate)) return;

            const nextDay = new Date(currentDate);
            nextDay.setDate(currentDate.getDate() + 1);
            
            // Simple check: skip weekends (Saturday=6, Sunday=0)
            const day = nextDay.getDay();
            if (day === 0 || day === 6) return;

            // We skip public holiday check here to keep it simple/robust without full calendar lib dependency
            // If user wants strict holiday check, they should use the full schedule board
            
            const nextDayStr = format(nextDay, 'yyyy-MM-dd');
            
            // Check if next day is free
            const nextDayShifts = await db.ShiftEntry.filter({ date: nextDayStr, doctor_id: wish.doctor_id });
            if (nextDayShifts.length === 0) {
                await db.ShiftEntry.create({
                    date: nextDayStr,
                    position: 'Frei',
                    doctor_id: wish.doctor_id,
                    note: 'Autom. Freizeitausgleich (Wunsch)'
                });
            }
        }
    };

    const updateWishMutation = useMutation({
        mutationFn: async ({ id, status, wish }) => {
            const updated = await db.WishRequest.update(id, { status, user_viewed: false });
            
            // If approved and has specific position, create shift
            if (status === 'approved' && wish && wish.type === 'service' && wish.position) {
                await handleAutoShiftCreation(wish, wish.date);
            }
            return updated;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['allPendingWishes']);
            queryClient.invalidateQueries(['wishes']);
            queryClient.invalidateQueries(['shifts']);
        },
        onError: (error) => {
            console.error('Fehler beim Aktualisieren des Wunsches:', error);
            toast({
                title: "Fehler",
                description: "Der Wunsch konnte nicht aktualisiert werden: " + error.message,
                variant: "destructive"
            });
        }
    });

    const deleteWishMutation = useMutation({
        mutationFn: async (wish) => {
            // If deleting an approved service wish, remove shift
            if (wish.status === 'cancellation_requested' && wish.type === 'service') {
                 const shifts = await db.ShiftEntry.filter({ 
                    date: wish.date, 
                    doctor_id: wish.doctor_id 
                });
                const shift = shifts.find(s => !wish.position || s.position === wish.position);
                if (shift) {
                    await db.ShiftEntry.delete(shift.id);
                    // Also notify user? Not strictly needed as they requested it.
                }
            }
            return db.WishRequest.delete(wish.id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['allPendingWishes']);
            queryClient.invalidateQueries(['wishes']);
            queryClient.invalidateQueries(['shifts']);
        },
        onError: (error) => {
            console.error('Fehler beim Löschen des Wunsches:', error);
            toast({
                title: "Fehler",
                description: "Der Wunsch konnte nicht gelöscht werden: " + error.message,
                variant: "destructive"
            });
        }
    });

    const silentDeleteWishMutation = useMutation({
        mutationFn: (wishId) => db.WishRequest.delete(wishId),
        onSuccess: () => {
            queryClient.invalidateQueries(['allPendingWishes']);
            queryClient.invalidateQueries(['wishes']);
        },
        onError: (error) => {
            console.error('Fehler beim stillen Löschen des Wunsches:', error);
            toast({
                title: "Fehler",
                description: "Der Wunsch konnte nicht gelöscht werden: " + error.message,
                variant: "destructive"
            });
        }
    });

    const handleQuickDecision = (wish, action) => {
        if (wish.status === 'cancellation_requested') {
            if (action === 'approve_cancellation') {
                // Approve Cancellation -> Delete Wish
                deleteWishMutation.mutate(wish);
            } else {
                // Reject Cancellation -> Revert to Approved
                updateWishMutation.mutate({ id: wish.id, status: 'approved', wish });
            }
        } else {
            // Normal Pending Wish
            updateWishMutation.mutate({ id: wish.id, status: action, wish });
        }
    };

    // Process Data
    const today = startOfDay(new Date());
    
    const upcomingServices = shifts.filter(s => {
        if (!s || !s.position || !s.date) return false;
        const d = safeParseISO(s.date);
        if (!d) return false;
        return ["Dienst Vordergrund", "Dienst Hintergrund", "Spätdienst"].includes(s.position) &&
            (isAfter(d, today) || isSameDay(d, today));
    });

    const upcomingAbsences = shifts.filter(s => {
        if (!s || !s.position || !s.date) return false;
        const d = safeParseISO(s.date);
        if (!d) return false;
        return ["Urlaub", "Dienstreise", "Krank", "Frei"].includes(s.position) &&
            (isAfter(d, today) || isSameDay(d, today));
    });

    const pendingWishes = wishes.filter(w => w.status === 'pending' || w.status === 'cancellation_requested');
    const recentDecisions = wishes.filter(w => w.status !== 'pending' && w.status !== 'cancellation_requested').slice(0, 5);

    if (!isAuthenticated) return <div className="p-8">Bitte anmelden.</div>;
    if (isLoadingDocs) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="container mx-auto max-w-7xl space-y-6 px-2 sm:px-4">
            {/* Header */}
            <div className="flex flex-col gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2">
                        <LayoutDashboard className="w-6 h-6 sm:w-8 sm:h-8 text-indigo-600" />
                        Mein Dashboard
                    </h1>
                    <p className="text-slate-500 mt-1 text-sm sm:text-base">
                        Übersicht für {selectedDoctor ? selectedDoctor.name : '...'}
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                    {/* Email Notification Switch in Header */}
                    {selectedDoctor && (
                        <div className="flex items-center justify-between gap-3 bg-white p-2 rounded-lg border shadow-sm" title={!selectedDoctor.email ? "Keine Benachrichtigungs-E-Mail-Adresse in den Mitarbeiter-Stammdaten hinterlegt." : "E-Mail Benachrichtigungen aktivieren"}>
                            <div className="flex items-center gap-2">
                                <Mail className={`w-4 h-4 ${selectedDoctor.receive_email_notifications ? 'text-indigo-600' : 'text-slate-400'}`} />
                                <span className="text-sm font-medium text-slate-700">E-Mail Alerts</span>
                            </div>
                            <Switch 
                                checked={selectedDoctor.receive_email_notifications || false}
                                disabled={!selectedDoctor.email}
                                onCheckedChange={(checked) => updateDoctorMutation.mutate({ receive_email_notifications: checked })}
                            />
                        </div>
                    )}

                    {isAdmin && (
                        <div className="flex items-center gap-2 bg-white p-2 rounded-lg border shadow-sm">
                            <User className="w-4 h-4 text-slate-400 hidden sm:block" />
                            <span className="text-sm font-medium text-slate-700 mr-2 hidden sm:inline">Ansicht für:</span>
                            <Select value={selectedDoctorId || ''} onValueChange={setSelectedDoctorId}>
                                <SelectTrigger className="w-full sm:w-[250px]">
                                    <SelectValue placeholder="Person wählen..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {doctors.map(doc => (
                                        <SelectItem key={doc.id} value={doc.id}>
                                            {doc.name} ({doc.role})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
            </div>

            {/* Admin Tasks Section */}
            {isAdmin && (
                <AdminTasksSection 
                    allPendingWishes={allPendingWishes}
                    isLoadingPending={isLoadingPending}
                    doctors={doctors}
                    handleQuickDecision={handleQuickDecision}
                    silentDeleteWishMutation={silentDeleteWishMutation}
                    isUpdating={updateWishMutation.isPending || deleteWishMutation.isPending || silentDeleteWishMutation.isPending}
                />
            )}

            {/* Wish Reminder Status (Admin, compact) */}
            {isAdmin && (() => {
                // Show status for next 3 months
                const now = new Date();
                const months = [0, 1, 2].map(i => {
                    const d = addMonths(now, i + 1);
                    return format(d, 'yyyy-MM');
                });
                return (
                    <div className="space-y-1">
                        {months.map(m => (
                            <WishReminderStatus key={m} targetMonth={m} compact />
                        ))}
                    </div>
                );
            })()}

            {!selectedDoctorId ? (
                <Card>
                    <CardContent className="p-12 text-center text-slate-500">
                        {user?.doctor_id ? "Lade Daten..." : "Kein Profil zugeordnet. Bitte wenden Sie sich an einen Administrator."}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    
                    {/* Left Column: Services */}
                    <Card className="lg:col-span-1 h-full flex flex-col">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2">
                                <CalendarDays className="w-5 h-5 text-blue-600" />
                                Nächste Dienste
                            </CardTitle>
                            <CardDescription>Kommende Einsätze & Rotationen</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-auto p-0">
                            {isLoadingShifts ? (
                                <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
                            ) : upcomingServices.length === 0 ? (
                                <div className="p-6 text-center text-slate-500 text-sm">Keine kommenden Dienste geplant.</div>
                            ) : (
                                <Table>
                                    <TableBody>
                                        {upcomingServices.slice(0, 10).map(shift => (
                                            <TableRow key={shift.id}>
                                                <TableCell className="font-medium w-[100px]">
                                                    {safeFormatDate(shift.date, 'dd.MM. yy', { locale: de })}
                                                </TableCell>
                                                <TableCell className="text-slate-500 text-xs">
                                                    {safeFormatDate(shift.date, 'EEEE', { locale: de })}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                        {shift.position}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    {/* Middle Column: Absences & Alerts */}
                    <Card className="lg:col-span-1 h-full flex flex-col">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="w-5 h-5 text-amber-600" />
                                Abwesenheiten & Infos
                            </CardTitle>
                            <CardDescription>Geplanter Urlaub & Änderungen</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-auto p-0">

                            {/* Alerts Section */}
                            {notifications.length > 0 && (
                                <div className="bg-amber-50 border-b border-amber-100 p-3 space-y-2">
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center">
                                            <AlertCircle className="w-3 h-3 mr-1" />
                                            Planänderungen
                                        </h4>
                                        <Button 
                                            size="sm" 
                                            variant="ghost" 
                                            className="h-6 px-2 text-[10px] text-amber-700 hover:bg-amber-100 hover:text-amber-900"
                                            onClick={() => bulkAcknowledgeMutation.mutate()}
                                        >
                                            <Check className="w-3 h-3 mr-1" />
                                            Alles abhaken
                                        </Button>
                                    </div>
                                    {notifications.map(notif => (
                                        <div key={notif.id} className="bg-white p-2 rounded border border-amber-200 shadow-sm text-sm flex justify-between items-start gap-2">
                                            <div>
                                                <div className="font-medium text-slate-800">
                                                    {safeFormatDate(notif.date, 'dd.MM.yyyy')}
                                                </div>
                                                <div className="text-slate-600 text-xs mt-0.5">
                                                    {notif.message}
                                                </div>
                                            </div>
                                            <Button 
                                                size="icon" 
                                                variant="ghost" 
                                                className="h-6 w-6 text-slate-400 hover:text-green-600 hover:bg-green-50"
                                                onClick={() => acknowledgeNotificationMutation.mutate(notif.id)}
                                            >
                                                <Check className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {isLoadingShifts ? (
                                <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
                            ) : upcomingAbsences.length === 0 ? (
                                <div className="p-6 text-center text-slate-500 text-sm">Keine Abwesenheiten geplant.</div>
                            ) : (
                                <Table>
                                    <TableBody>
                                        {upcomingAbsences.slice(0, 10).map(shift => (
                                            <TableRow key={shift.id}>
                                                <TableCell className="font-medium w-[100px]">
                                                    {safeFormatDate(shift.date, 'dd.MM. yy', { locale: de })}
                                                </TableCell>
                                                <TableCell className="text-slate-500 text-xs">
                                                    {safeFormatDate(shift.date, 'EEEE', { locale: de })}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={
                                                        shift.position === 'Urlaub' ? "bg-green-50 text-green-700 border-green-200" :
                                                        shift.position === 'Krank' ? "bg-red-50 text-red-700 border-red-200" :
                                                        "bg-slate-50 text-slate-700 border-slate-200"
                                                    }>
                                                        {shift.position}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    {/* Right Column: Wishes */}
                    <Card className="lg:col-span-1 h-full flex flex-col">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2">
                                <AlertCircle className="w-5 h-5 text-indigo-600" />
                                Wünsche & Status
                            </CardTitle>
                            <CardDescription>Meine Anträge in der Wunschkiste</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-auto p-4 space-y-6">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-900 mb-3">Offene Anfragen</h4>
                                {isLoadingWishes ? (
                                    <Loader2 className="animate-spin text-slate-400" />
                                ) : pendingWishes.length === 0 ? (
                                    <div className="text-sm text-slate-500 italic">Keine offenen Anfragen.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {pendingWishes.map(w => (
                                            <div key={w.id} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium">{safeFormatDate(w.date, 'dd.MM.yyyy')}</span>
                                                    <span className="text-xs text-slate-500">
                                                        {w.type === 'service' ? 'Dienstwunsch' : 'Kein Dienst'}
                                                    </span>
                                                </div>
                                                <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">
                                                    Ausstehend
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-slate-900 mb-3">Letzte Entscheidungen</h4>
                                {isLoadingWishes ? (
                                    <Loader2 className="animate-spin text-slate-400" />
                                ) : recentDecisions.length === 0 ? (
                                    <div className="text-sm text-slate-500 italic">Keine vergangenen Entscheidungen.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {recentDecisions.map(w => (
                                            <div key={w.id} className="flex flex-col p-2 bg-white rounded border border-slate-100 gap-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-medium">{safeFormatDate(w.date, 'dd.MM.yyyy')}</span>
                                                    {w.status === 'approved' ? (
                                                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">
                                                            <CheckCircle2 className="w-3 h-3 mr-1" /> Genehmigt
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-0">
                                                            <XCircle className="w-3 h-3 mr-1" /> Abgelehnt
                                                        </Badge>
                                                    )}
                                                </div>
                                                {w.admin_comment && (
                                                    <div className="text-xs text-slate-600 bg-slate-50 p-1.5 rounded">
                                                        <span className="font-semibold">Admin:</span> {w.admin_comment}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}