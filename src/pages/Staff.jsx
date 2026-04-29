import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/api/client';
import { suggestAlternativeName, suggestInitials, generateDefaultInitials } from '@/utils/nameUtils';
import NameSuggestion from '@/components/staff/NameSuggestion';
import { generateDefaultInitials } from '@/utils/nameUtils';

export default function Staff() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState(null);
  const [formData, setFormData] = useState({ name: '', initials: '', role: '', color: '', order: 0 });
  const [error, setError] = useState(null);
  const [suggestion, setSuggestion] = useState(null);

  // Fetch all doctors
  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list()
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (newDoctor) => db.Doctor.create(newDoctor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctors'] });
      closeDialog();
    },
    onError: (err) => {
      // Handle 409 conflict
      if (err.status === 409) {
        const responseData = err.data;
        setError(responseData.error || 'Mitarbeiter mit diesem Namen existiert bereits.');
        if (responseData.suggestions) {
          setSuggestion(responseData.suggestions);
        } else {
          // Fallback: clientseitige Vorschläge generieren
          const existingNames = doctors.map(d => d.name);
          const existingInitials = doctors.map(d => d.initials).filter(Boolean);
          const altName = suggestAlternativeName(formData.name, existingNames);
          const altInitials = suggestInitials(formData.name, existingInitials);
          setSuggestion({ name: altName, initials: altInitials });
        }
      } else {
        setError('Ein Fehler ist aufgetreten: ' + (err.message || 'Unbekannter Fehler'));
      }
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.Doctor.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctors'] });
      closeDialog();
    },
    onError: (err) => {
      if (err.status === 409) {
        const responseData = err.data;
        setError(responseData.error || 'Mitarbeiter mit diesem Namen existiert bereits.');
        if (responseData.suggestions) {
          setSuggestion(responseData.suggestions);
        } else {
          const existingNames = doctors.filter(d => d.id !== editingDoctor?.id).map(d => d.name);
          const existingInitials = doctors.filter(d => d.id !== editingDoctor?.id).map(d => d.initials).filter(Boolean);
          const altName = suggestAlternativeName(formData.name, existingNames);
          const altInitials = suggestInitials(formData.name, existingInitials);
          setSuggestion({ name: altName, initials: altInitials });
        }
      } else {
        setError('Ein Fehler ist aufgetreten: ' + (err.message || 'Unbekannter Fehler'));
      }
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => db.Doctor.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doctors'] })
  });

  const openAddDialog = () => {
    setEditingDoctor(null);
    setFormData({ name: '', initials: '', role: '', color: '#000000', order: 0 });
    setError(null);
    setSuggestion(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (doctor) => {
    setEditingDoctor(doctor);
    setFormData({
      name: doctor.name,
      initials: doctor.initials || '',
      role: doctor.role || '',
      color: doctor.color || '#000000',
      order: doctor.order || 0
    });
    setError(null);
    setSuggestion(null);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingDoctor(null);
    setFormData({ name: '', initials: '', role: '', color: '', order: 0 });
    setError(null);
    setSuggestion(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Name darf nicht leer sein.');
      return;
    }
    const payload = { ...formData };
    if (editingDoctor) {
      updateMutation.mutate({ id: editingDoctor.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleAcceptSuggestion = (suggestion) => {
    setFormData(prev => ({
      ...prev,
      name: suggestion.name,
      initials: suggestion.initials
    }));
    setError(null);
    setSuggestion(null);
  };

  // Automatisches Setzen des Initialen-Feldes, wenn der Name geändert wird und nicht manuell überschrieben wurde
  const handleNameChange = (e) => {
    const newName = e.target.value;
    setFormData(prev => {
      // Nur autom. generieren, wenn das Kürzel-Feld leer oder dem vorherigen autom. Wert entspricht
      const prevAuto = prev.name ? generateDefaultInitials(prev.name) : '';
      const shouldAuto = !prev.initials || prev.initials === prevAuto;
      return {
        ...prev,
        name: newName,
        initials: shouldAuto ? generateDefaultInitials(newName) : prev.initials
      };
    });
  };

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <Button onClick={openAddDialog}><Plus className="w-4 h-4 mr-2" /> Neu</Button>
      </div>

      {isLoading ? (
        <p>Lade...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kürzel</TableHead>
              <TableHead>Rolle</TableHead>
              <TableHead>Farbe</TableHead>
              <TableHead>Reihenfolge</TableHead>
              <TableHead>Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {doctors.map(doc => (
              <TableRow key={doc.id}>
                <TableCell>{doc.name}</TableCell>
                <TableCell>{doc.initials || '-'}</TableCell>
                <TableCell>{doc.role}</TableCell>
                <TableCell>
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: doc.color }} />
                </TableCell>
                <TableCell>{doc.order}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={() => openEditDialog(doc)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => deleteMutation.mutate(doc.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDoctor ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={formData.name} onChange={handleNameChange} placeholder="Max Mustermann" required />
              </div>
              <div>
                <Label htmlFor="initials">Kürzel</Label>
                <Input id="initials" value={formData.initials} onChange={e => setFormData({ ...formData, initials: e.target.value })} placeholder="MM" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="role">Rolle</Label>
                <Input id="role" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="color">Farbe</Label>
                <div className="flex items-center gap-2">
                  <Input id="color" type="color" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} className="w-12 h-8 p-0 border-0" />
                  <Input value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} placeholder="#000000" />
                </div>
              </div>
              <div>
                <Label htmlFor="order">Reihenfolge</Label>
                <Input id="order" type="number" value={formData.order} onChange={e => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
            )}
            <NameSuggestion suggestion={suggestion} onAccept={handleAcceptSuggestion} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Abbrechen</Button>
              <Button type="submit" disabled={createMutation.isLoading || updateMutation.isLoading}>
                {createMutation.isLoading || updateMutation.isLoading ? 'Speichern...' : 'Speichern'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
