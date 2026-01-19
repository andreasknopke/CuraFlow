import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ChartCard({ title, description, children, defaultHeight = "h-[300px]", className }) {
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Esc key to exit
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') setIsFullscreen(false);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    if (isFullscreen) {
        return (
            <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in duration-200">
                <div className="flex items-center justify-between p-4 border-b bg-slate-50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                        {description && <p className="text-sm text-slate-500">{description}</p>}
                    </div>
                    <Button variant="outline" size="icon" onClick={() => setIsFullscreen(false)}>
                        <Minimize2 className="h-5 w-5" />
                    </Button>
                </div>
                <div className="flex-1 p-6 min-h-0 bg-white">
                    <div className="h-full w-full">
                        {children}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Card className={cn("relative transition-all hover:shadow-md", className)}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pr-2">
                <div className="space-y-1 pr-4">
                    <CardTitle>{title}</CardTitle>
                    {description && <CardDescription>{description}</CardDescription>}
                </div>
                <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-slate-400 hover:text-slate-900 shrink-0"
                    onClick={() => setIsFullscreen(true)}
                >
                    <Maximize2 className="h-4 w-4" />
                </Button>
            </CardHeader>
            <CardContent className="pl-2">
                <div className={defaultHeight}>
                    {children}
                </div>
            </CardContent>
        </Card>
    );
}