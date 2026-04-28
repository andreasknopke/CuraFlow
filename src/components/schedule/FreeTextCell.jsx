import React, { useState, useEffect } from 'react';
import { format, isSameDay } from 'date-fns';

export default function FreeTextCell({ date, rowName, notes, onCreate, onUpdate, onDelete }) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const isToday = isSameDay(date, new Date());
    const note = notes.find(n => n.date === dateStr && n.position === rowName);
    const [value, setValue] = useState(note?.content || "");
    
    useEffect(() => {
        setValue(note?.content || "");
    }, [note, dateStr]); // dateStr hinzugefügt, um State bei Wochenwechsel zurückzusetzen

    const handleBlur = () => {
        const currentContent = note?.content || "";
        if (value === currentContent) return;

        if (!value.trim()) {
            if (note) onDelete.mutate(note.id);
        } else {
            if (note) {
                onUpdate.mutate({ id: note.id, data: { content: value } });
            } else {
                onCreate.mutate({ date: dateStr, position: rowName, content: value });
            }
        }
    };

    return (
        <div className={`relative h-full min-h-[60px] transition-colors ${isToday ? 'bg-yellow-50/30 border-x-2 border-x-yellow-400 border-y border-y-slate-100' : 'bg-purple-50/20 hover:bg-purple-50/40 border border-transparent'}`}>
            {/* Invisible div to force height expansion */}
            <div className="invisible p-2 text-base whitespace-pre-wrap break-words min-h-[60px]" aria-hidden="true">
                {value || '...'}
            </div>
            <textarea
                className="absolute inset-0 w-full h-full bg-transparent resize-none p-2 text-base focus:outline-none focus:ring-1 focus:ring-purple-300 focus:bg-white/50 text-slate-700 placeholder:text-purple-300/50 rounded-none overflow-hidden"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                placeholder="..."
            />
        </div>
    );
}