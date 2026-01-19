import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Settings, Loader2 } from 'lucide-react';

const DAYS = [
  { id: 1, label: "Mo" },
  { id: 2, label: "Di" },
  { id: 3, label: "Mi" },
  { id: 4, label: "Do" },
  { id: 5, label: "Fr" },
  { id: 6, label: "Sa" },
  { id: 0, label: "So" },
];

const DEMO_ROWS = [
    "Chir-Demo", "Int-Demo", "Kardio-Demo", "Neonatologie", 
    "Mamma-Konsil", "Onko-Konsil", "Gefäß-Konsil", "Gyn-Konsil", "Trauma-Demo"
];

const DemoRow = ({ rowName, setting, onTimeChange, onDayToggle }) => {
    const [time, setTime] = useState(setting.time || '');
    const activeDays = setting.active_days || [];

    // Update local state when setting changes from outside (e.g. refetch)
    useEffect(() => {
        setTime(setting.time || '');
    }, [setting.time]);

    const handleBlur = () => {
        if (time !== setting.time) {
            onTimeChange(rowName, time);
        }
    };

    return (
        <div className="flex flex-col space-y-3 p-4 border rounded-lg bg-slate-50">
            <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-900">{rowName}</h4>
                <div className="flex items-center gap-2">
                    <Label htmlFor={`time-${rowName}`} className="text-xs text-slate-500">Uhrzeit:</Label>
                    <Input 
                        id={`time-${rowName}`}
                        value={time} 
                        onChange={(e) => setTime(e.target.value)}
                        onBlur={handleBlur}
                        placeholder="z.B. 13:00"
                        className="h-8 w-24 bg-white"
                    />
                </div>
            </div>
            <div className="flex gap-2 flex-wrap">
                {DAYS.map(day => {
                    const isActive = activeDays.includes(day.id);
                    return (
                        <Button
                            key={day.id}
                            type="button"
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            onClick={() => onDayToggle(rowName, day.id)}
                            className={`w-10 h-10 p-0 rounded-full ${isActive ? 'bg-indigo-600 hover:bg-indigo-700' : 'text-slate-400'}`}
                        >
                            {day.label}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
};

export default function DemoSettingsDialog() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = React.useState(false);

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['demoSettings'],
    queryFn: () => base44.entities.DemoSetting.list(),
  });
  
  const createOrUpdate = useMutation({
      mutationFn: async ({ name, active_days, time }) => {
          const existing = settings.find(s => s.name === name);
          if (existing) {
              return base44.entities.DemoSetting.update(existing.id, { active_days, time });
          } else {
              return base44.entities.DemoSetting.create({ name, active_days, time });
          }
      },
      onSuccess: () => queryClient.invalidateQueries(['demoSettings'])
  });

  const getSetting = (name) => settings.find(s => s.name === name) || { active_days: [1, 2, 3, 4, 5], time: "" };

  const handleDayToggle = (name, dayId) => {
      const current = getSetting(name);
      const currentDays = current.active_days || [];
      const newDays = currentDays.includes(dayId)
          ? currentDays.filter(d => d !== dayId)
          : [...currentDays, dayId];
      
      createOrUpdate.mutate({ name, active_days: newDays, time: current.time });
  };

  const handleTimeChange = (name, time) => {
      const current = getSetting(name);
      createOrUpdate.mutate({ name, active_days: current.active_days || [], time });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="w-4 h-4" />
          Demo-Zeiten
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Konfiguration Demonstrationen & Konsile</DialogTitle>
          <DialogDescription>
            Legen Sie fest, an welchen Tagen und zu welcher Uhrzeit die jeweiligen Demos stattfinden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isLoading ? (
             <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
          ) : (
            DEMO_ROWS.map(rowName => (
                <DemoRow 
                    key={rowName}
                    rowName={rowName}
                    setting={getSetting(rowName)}
                    onTimeChange={handleTimeChange}
                    onDayToggle={handleDayToggle}
                />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}