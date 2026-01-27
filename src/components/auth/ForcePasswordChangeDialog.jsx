import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/api/client";
import { AlertTriangle } from "lucide-react";

export default function ForcePasswordChangeDialog({ isOpen, onPasswordChanged }) {
  const { toast } = useToast();
  const [isChanging, setIsChanging] = useState(false);
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (form.newPassword !== form.confirmPassword) {
      toast({
        title: "Fehler",
        description: "Die neuen Passwörter stimmen nicht überein",
        variant: "destructive"
      });
      return;
    }

    if (form.newPassword.length < 8) {
      toast({
        title: "Fehler",
        description: "Das Passwort muss mindestens 8 Zeichen lang sein",
        variant: "destructive"
      });
      return;
    }

    if (form.newPassword === form.currentPassword) {
      toast({
        title: "Fehler",
        description: "Das neue Passwort muss sich vom aktuellen Passwort unterscheiden",
        variant: "destructive"
      });
      return;
    }

    setIsChanging(true);
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      
      toast({
        title: "Erfolg",
        description: "Ihr Passwort wurde erfolgreich geändert"
      });
      
      onPasswordChanged();
    } catch (error) {
      toast({
        title: "Fehler",
        description: error.message || "Passwort konnte nicht geändert werden",
        variant: "destructive"
      });
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent 
        className="sm:max-w-[500px]" 
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-full">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <DialogTitle>Passwort ändern erforderlich</DialogTitle>
              <DialogDescription>
                Sie verwenden das Standard-Passwort. Bitte ändern Sie es aus Sicherheitsgründen.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
            <strong>Wichtig:</strong> Wählen Sie ein sicheres Passwort mit mindestens 8 Zeichen.
          </div>
          
          <div>
            <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
            <Input
              id="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required
              disabled={isChanging}
              placeholder="Ihr aktuelles Passwort"
              autoFocus
            />
          </div>
          
          <div>
            <Label htmlFor="newPassword">Neues Passwort</Label>
            <Input
              id="newPassword"
              type="password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              required
              minLength={8}
              disabled={isChanging}
              placeholder="Mindestens 8 Zeichen"
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">Neues Passwort bestätigen</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              required
              minLength={8}
              disabled={isChanging}
              placeholder="Passwort wiederholen"
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isChanging} className="w-full sm:w-auto">
              {isChanging ? 'Wird geändert...' : 'Passwort ändern'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
