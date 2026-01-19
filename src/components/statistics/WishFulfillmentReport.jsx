import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ChartCard from "@/components/statistics/ChartCard";

export default function WishFulfillmentReport({ doctors, wishes, shifts }) {
    const stats = useMemo(() => {
        const data = doctors.map(doc => {
            const docWishes = wishes.filter(w => w.doctor_id === doc.id);
            if (docWishes.length === 0) return null;

            let fulfilled = 0;
            let total = docWishes.length;
            let approved = 0;
            let rejected = 0;

            docWishes.forEach(wish => {
                if (wish.status === 'approved') approved++;
                if (wish.status === 'rejected') rejected++;

                const shiftOnDate = shifts.find(s => s.date === wish.date && s.doctor_id === doc.id);
                
                // Logic: Did reality match wish?
                let isFulfilled = false;

                if (wish.type === 'service') {
                    // Wanted service. Did they get a service shift?
                    // Assuming positions in "Dienste" category or specific known service names.
                    // Since we don't have the category map easily here, we rely on naming conventions or passed props.
                    // For now, let's assume "Dienst" in name or specific list.
                    const isServiceShift = shiftOnDate && (
                        shiftOnDate.position.includes("Dienst") || 
                        shiftOnDate.position === "Spätdienst"
                    );
                    if (isServiceShift) isFulfilled = true;
                } else {
                    // Wanted NO service. 
                    // Fulfilled if they have NO shift, OR a non-service shift (like Rotation, Free, Vacation)
                    // Basically, failed if they HAVE a service shift.
                    const isServiceShift = shiftOnDate && (
                        shiftOnDate.position.includes("Dienst") || 
                        shiftOnDate.position === "Spätdienst"
                    );
                    if (!isServiceShift) isFulfilled = true;
                }

                if (isFulfilled) fulfilled++;
            });

            return {
                name: doc.name,
                role: doc.role,
                total,
                fulfilled,
                rate: total > 0 ? Math.round((fulfilled / total) * 100) : 0,
                approved,
                rejected
            };
        }).filter(Boolean).sort((a, b) => b.rate - a.rate);

        return data;
    }, [doctors, wishes, shifts]);

    if (!stats || stats.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Wunscherfüllung</CardTitle>
                    <CardDescription>Keine Wünsche für diesen Zeitraum gefunden.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <ChartCard 
                title="Wunscherfüllungsquote (%)" 
                description="Prozentsatz der erfüllten Dienstwünsche pro Arzt"
                defaultHeight="h-[350px]"
            >
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} />
                        <XAxis type="number" domain={[0, 100]} />
                        <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 11}} />
                        <Tooltip 
                            formatter={(value) => `${value}%`}
                            contentStyle={{backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0'}}
                        />
                        <Bar dataKey="rate" name="Erfüllungsquote" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            <Card>
                <CardHeader>
                    <CardTitle>Details Wunscherfüllung</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Arzt</TableHead>
                                <TableHead className="text-right">Wünsche Gesamt</TableHead>
                                <TableHead className="text-right text-green-600">Erfüllt (Realität)</TableHead>
                                <TableHead className="text-right">Quote</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stats.map((item) => (
                                <TableRow key={item.name}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell className="text-right">{item.total}</TableCell>
                                    <TableCell className="text-right font-bold text-green-600">{item.fulfilled}</TableCell>
                                    <TableCell className="text-right">{item.rate}%</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}