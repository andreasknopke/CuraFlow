import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format, addMonths, isBefore, startOfDay } from "date-fns";
import { de } from "date-fns/locale";
import { CheckCircle2, XCircle, Trash2, AlertCircle, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { db } from '@/components/db';

export default function WishRequestDialog({ 
    isOpen, 
    onClose, 
    wish, 
    date, 
    doctorName, 
    isReadOnly, 
    isAdmin, 
    onSave, 
    onDelete,
    activePosition
}) {
    const [formData, setFormData] = useState({
        type: 'service',
        position: '',
        priority: 'medium',
        reason: '',
        status: 'pending',
        admin_comment: ''
    });

    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
    });

    // Deadline Logic
    const deadlineMonths = settings.find(s => s.key === 'wish_deadline_months')?.value;
    const isDeadlineRestricted = !isAdmin && deadlineMonths && !isNaN(parseInt(deadlineMonths)); // Admins bypass
    let isBlockedByDeadline = false;
    let minDate = null;

    if (isDeadlineRestricted && date) {
        minDate = addMonths(startOfDay(new Date()), parseInt(deadlineMonths));
        // If date is BEFORE minDate, block.
        if (isBefore(date, minDate)) {
            isBlockedByDeadline = true;
        }
    }

    useEffect(() => {
        if (isOpen) {
            if (wish) {
                setFormData({
                    type: wish.type || 'service',
                    position: wish.position || activePosition,
                    priority: wish.priority || 'medium',
                    reason: wish.reason || '',
                    status: wish.status || 'pending',
                    admin_comment: wish.admin_comment || ''
                });
            } else {
                setFormData({
                    type: 'service',
                    position: activePosition,
                    priority: 'medium',
                    reason: '',
                    status: 'pending',
                    admin_comment: ''
                });
            }
        }
    }, [isOpen, wish, activePosition]);

    // Check if approval is required based on settings
    const getRequiresApproval = () => {
        const approvalSettingRaw = settings.find(s => s.key === 'wish_approval_rules')?.value;
        if (!approvalSettingRaw) return true; // Default: requires approval
        
        try {
            const rules = JSON.parse(approvalSettingRaw);
            
            if (formData.type === 'no_service') {
                return rules.no_service_requires_approval ?? false;
            }
            
            // For service wishes, check position override first
            if (formData.type === 'service' && formData.position) {
                const positionOverride = rules.position_overrides?.[formData.position];
                if (positionOverride !== undefined) {
                    return positionOverride;
                }
            }
            
            return rules.service_requires_approval ?? true;
        } catch {
            return true;
        }
    };

    // Check if auto-create shift on approval is enabled
    const getAutoCreateShiftOnApproval = () => {
        const approvalSettingRaw = settings.find(s => s.key === 'wish_approval_rules')?.value;
        if (!approvalSettingRaw) return false;
        try {
            const rules = JSON.parse(approvalSettingRaw);
            return rules.auto_create_shift_on_approval ?? false;
        } catch {
            return false;
        }
    };

    const handleSubmit = () => {
        const requiresApproval = getRequiresApproval();
        const dataToSave = { ...formData };
        
        // Auto-approve if no approval required and it's a new wish (not editing)
        if (!requiresApproval && !wish && !isAdmin) {
            dataToSave.status = 'approved';
        }
        
        // Flag to create shift if approval is being granted and setting is enabled
        const wasNotApproved = !wish || wish.status !== 'approved';
        const isNowApproved = dataToSave.status === 'approved';
        const autoCreateShift = getAutoCreateShiftOnApproval();
        
        if (wasNotApproved && isNowApproved && autoCreateShift && dataToSave.type === 'service' && dataToSave.position) {
            dataToSave._createShift = true;
        }
        
        onSave(dataToSave);
        onClose();
    };

    const handleDelete = () => {
        if (!isAdmin && wish?.status === 'approved') {
            if (window.confirm("Für genehmigte Wünsche muss eine Stornierung angefragt werden. Anfrage jetzt senden?")) {
                onSave({ ...formData, status: 'cancellation_requested' });
                onClose();
            }
            return;
        }

        if (window.confirm("Möchten Sie diesen Eintrag wirklich löschen?")) {
            onDelete();
            onClose();
        }
    };

    if (!date) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>
                        Wunsch für {format(date, 'EEEE, d. MMMM yyyy', { locale: de })}
                    </DialogTitle>
                    <p className="text-sm text-slate-500">
                        Arzt: {doctorName}
                    </p>
                </DialogHeader>

                {isBlockedByDeadline && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm mb-2 flex items-start">
                        <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                        <div>
                            <strong>Frist überschritten:</strong> Wünsche können nur {deadlineMonths} Monate im Voraus eingereicht werden. 
                            Frühestes mögliches Datum: {minDate ? format(minDate, 'dd.MM.yyyy') : ''}.
                        </div>
                    </div>
                )}

                <div className="grid gap-6 py-4">
                    <div className="space-y-3">
                        <Label>Art des Wunsches</Label>
                        <RadioGroup 
                            value={formData.type} 
                            onValueChange={(val) => setFormData({...formData, type: val})}
                            className="flex gap-4"
                            disabled={(isReadOnly && !isAdmin) || isBlockedByDeadline}
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="service" id="r-service" />
                                <Label htmlFor="r-service" className="flex items-center cursor-pointer text-green-700 font-medium">
                                    <CheckCircle2 className="w-4 h-4 mr-2" />
                                    Dienstwunsch
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="no_service" id="r-no_service" />
                                <Label htmlFor="r-no_service" className="flex items-center cursor-pointer text-red-700 font-medium">
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Kein Dienst
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {formData.type === 'service' && activePosition && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 bg-indigo-50 p-3 rounded border border-indigo-100 text-indigo-900">
                            <Label className="text-xs uppercase tracking-wider font-semibold opacity-70">Dienst</Label>
                            <div className="font-medium text-lg">{activePosition}</div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Priorität</Label>
                            <Select 
                                value={formData.priority} 
                                onValueChange={(val) => setFormData({...formData, priority: val})}
                                disabled={(isReadOnly && !isAdmin) || isBlockedByDeadline}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="low">Niedrig</SelectItem>
                                    <SelectItem value="medium">Mittel</SelectItem>
                                    <SelectItem value="high">Hoch</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Begründung (Optional)</Label>
                        <Textarea 
                            placeholder="z.B. Hochzeit, Geburtstag, Fortbildung..." 
                            value={formData.reason}
                            onChange={(e) => setFormData({...formData, reason: e.target.value})}
                            disabled={(isReadOnly && !isAdmin) || isBlockedByDeadline}
                            className="resize-none"
                            rows={2}
                        />
                    </div>

                    {(isAdmin || (wish && (wish.status !== 'pending' || wish.admin_comment))) && (
                        <div className="border-t pt-4 space-y-4 bg-slate-50 p-4 rounded-lg">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <AlertCircle className="w-4 h-4" />
                                Administration / Genehmigung
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Status</Label>
                                    <Select 
                                        value={formData.status} 
                                        onValueChange={(val) => setFormData({...formData, status: val})}
                                        disabled={!isAdmin}
                                    >
                                        <SelectTrigger className={
                                            formData.status === 'approved' ? 'text-green-600 font-medium' :
                                            formData.status === 'rejected' ? 'text-red-600 font-medium' :
                                            'text-amber-600 font-medium'
                                        }>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pending">Ausstehend</SelectItem>
                                            <SelectItem value="approved">Genehmigt</SelectItem>
                                            <SelectItem value="rejected">Abgelehnt</SelectItem>
                                            <SelectItem value="cancellation_requested">Stornierung angefragt</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Kommentar (Admin)</Label>
                                <Textarea 
                                    placeholder="Begründung für Genehmigung/Ablehnung..." 
                                    value={formData.admin_comment}
                                    onChange={(e) => setFormData({...formData, admin_comment: e.target.value})}
                                    disabled={!isAdmin}
                                    className="resize-none bg-white"
                                    rows={2}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="sm:justify-between">
                    {wish ? (
                        <Button 
                            variant="destructive" 
                            onClick={handleDelete}
                            disabled={isReadOnly && !isAdmin}
                            type="button"
                        >
                            {(!isAdmin && wish.status === 'approved') ? (
                                <>
                                    <AlertCircle className="w-4 h-4 mr-2" />
                                    Stornierung anfragen
                                </>
                            ) : (
                                <>
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Löschen
                                </>
                            )}
                        </Button>
                    ) : (
                        <div />
                    )}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} type="button">
                            Abbrechen
                        </Button>
                        <Button onClick={handleSubmit} disabled={(isReadOnly && !isAdmin) || isBlockedByDeadline}>
                            Speichern
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}