
import { base44 } from "@/api/base44Client";

let pendingCount = 0;
let debounceTimeout = null;

export const trackDbChange = (count = 1) => {
    pendingCount += count;

    if (debounceTimeout) {
        clearTimeout(debounceTimeout);
    }

    const trigger = async () => {
        // Clear the debounce timeout reference, as we are now executing
        debounceTimeout = null; 
        
        const countToSend = pendingCount;
        pendingCount = 0; // Reset immediately to capture new changes during await

        try {
            const res = await base44.functions.invoke('adminTools', { action: 'register_change', count: countToSend });
            
            if (res.data && res.data.shouldBackup) {
                // Schedule backup when idle
                const runBackup = () => {
                    console.log("Idle state detected, triggering auto-backup...");
                    base44.functions.invoke('adminTools', { action: 'perform_auto_backup' })
                        .catch(e => console.error("Auto backup failed", e));
                };

                if (typeof window !== 'undefined' && window.requestIdleCallback) {
                    // 10s timeout to force run if never idle, giving preference to true idle time
                    window.requestIdleCallback(runBackup, { timeout: 10000 }); 
                } else {
                    // Fallback for environments without requestIdleCallback or non-browser contexts
                    setTimeout(runBackup, 5000);
                }
            }
        } catch (e) {
            console.error("Tracking failed [adminTools]", e);
            if (e.response) {
                console.error("Tracking Error Response:", e.response.status, e.response.data);
            }
        }
    };

    // Debounce for 5 seconds to gather bursts of changes
    debounceTimeout = setTimeout(trigger, 5000);
};
