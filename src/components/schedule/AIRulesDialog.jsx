import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, BrainCircuit, Sparkles } from 'lucide-react';

export default function AIRulesDialog() {
  const [newRule, setNewRule] = useState("");
  const queryClient = useQueryClient();

  const { data: rules = [] } = useQuery({
    queryKey: ['scheduleRules'],
    queryFn: () => base44.entities.ScheduleRule.list(),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => base44.entities.ScheduleRule.create(data),
    onSuccess: () => {
        queryClient.invalidateQueries(['scheduleRules']);
        setNewRule("");
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ScheduleRule.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['scheduleRules']),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.ScheduleRule.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['scheduleRules']),
  });

  const handleAdd = () => {
    if (!newRule.trim()) return;
    createRuleMutation.mutate({
        content: newRule,
        is_active: true
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
            <BrainCircuit className="w-4 h-4" />
            KI-Regeln
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            KI-Planungsregeln
          </DialogTitle>
          <DialogDescription>
            Definieren Sie zusätzliche Regeln, die der Algorithmus bei der Erstellung des Dienstplans berücksichtigen soll.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mt-4">
            <Input 
                placeholder="Neue Regel hinzufügen (z.B. 'Maximal 2 Spätdienste pro Woche')" 
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!newRule.trim()}>
                <Plus className="w-4 h-4" />
            </Button>
        </div>

        <div className="mt-4">
            <h4 className="text-sm font-medium text-slate-500 mb-2">Aktive Regeln</h4>
            <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                    {rules.length === 0 && (
                        <div className="text-center text-slate-400 py-8 italic">
                            Keine Regeln definiert.
                        </div>
                    )}
                    {rules.map(rule => (
                        <div key={rule.id} className="flex items-start justify-between bg-slate-50 p-3 rounded-md border border-slate-100 group">
                            <div className="flex items-start gap-3 flex-1 mr-4">
                                <Switch 
                                    checked={rule.is_active}
                                    onCheckedChange={(checked) => updateRuleMutation.mutate({
                                        id: rule.id,
                                        data: { is_active: checked }
                                    })}
                                    className="mt-1"
                                />
                                <span className={`text-sm ${!rule.is_active ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                    {rule.content}
                                </span>
                            </div>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => deleteRuleMutation.mutate(rule.id)}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}