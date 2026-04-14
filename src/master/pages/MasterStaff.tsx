import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, Loader2, Building2 } from 'lucide-react';

interface Tenant {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface StaffMember {
  tenantName: string;
  name: string;
  role?: string;
  is_active: boolean;
  qualifications?: string;
  notes?: string;
  [key: string]: unknown;
}

interface StaffData {
  staff: StaffMember[];
}

export default function MasterStaff() {
  const [selectedTenant, setSelectedTenant] = useState<string>('all');

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['master-tenants'],
    queryFn: async () => {
      try {
        return await api.request('/api/admin/db-tokens');
      } catch {
        return [];
      }
    },
  });

  const { data: staffData, isLoading } = useQuery<StaffData>({
    queryKey: ['master-staff', selectedTenant],
    queryFn: async () => {
      try {
        const params = selectedTenant !== 'all' ? `?tenantId=${selectedTenant}` : '';
        return await api.request(`/api/master/staff${params}`);
      } catch {
        return { staff: [] };
      }
    },
  });

  const staffList: StaffMember[] = staffData?.staff ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mitarbeiter</h1>
        <p className="text-slate-500 mt-1">
          Zusammengeführte Mitarbeiter-Stammdaten aller Mandanten
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={selectedTenant} onValueChange={setSelectedTenant}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Mandant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Mandanten</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge variant="outline" className="text-xs">
          {staffList.length} Mitarbeiter
        </Badge>
      </div>

      {/* Tabelle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Mitarbeiterverzeichnis
          </CardTitle>
          <CardDescription>Stammdaten aus allen Mandanten-Datenbanken</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Mitarbeiterdaten werden geladen…
            </div>
          ) : staffList.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Keine Mitarbeiterdaten gefunden.</p>
              <p className="text-sm mt-1">Stellen Sie sicher, dass Mandanten konfiguriert sind.</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mandant</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Qualifikationen</TableHead>
                    <TableHead>Notizen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffList.map((staff, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          <Building2 className="w-3 h-3 mr-1" />
                          {staff.tenantName}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{staff.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {staff.role || '–'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${staff.is_active ? 'text-emerald-600' : 'text-slate-400'}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${staff.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                          />
                          {staff.is_active ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500 max-w-[200px] truncate">
                        {staff.qualifications || '–'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500 max-w-[150px] truncate">
                        {staff.notes || '–'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
