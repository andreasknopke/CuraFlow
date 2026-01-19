import { base44 } from '@/api/base44Client';
import { Base44Adapter } from './Base44Adapter';
import { MySQLAdapter } from './MySQLAdapter';
import _ from 'lodash';

// Cache for DB Mode to avoid fetching on every call
// Default to MySQL mode since we're using external DB only now
let cachedMode = 'mysql'; 
let lastFetch = Date.now(); // Pretend we just fetched
const CACHE_TTL = 30000; // 30 seconds

// Initialize from localStorage (but default is now 'mysql')
try {
    const localMode = localStorage.getItem('radioplan_db_mode');
    if (localMode) cachedMode = localMode;
    else cachedMode = 'mysql'; // Force MySQL if nothing stored
} catch {
    cachedMode = 'mysql';
}

// Export helper to force set mode (for admin panel)
export const setDbMode = (mode) => {
    cachedMode = mode;
    lastFetch = Date.now();
    try {
        localStorage.setItem('radioplan_db_mode', mode);
    } catch {}
};

// Throttle for mismatch logging to avoid Rate Limit Exceeded
let mismatchLogCount = 0;
let mismatchLogReset = Date.now();
const MAX_MISMATCH_LOGS_PER_MINUTE = 5;

const getDbMode = async () => {
    const now = Date.now();
    if (cachedMode && (now - lastFetch < CACHE_TTL)) return cachedMode;

    try {
        // Use direct SDK to avoid infinite recursion
        const settings = await base44.entities.SystemSetting.list();
        const setting = settings.find(s => s.key === 'db_mode');
        cachedMode = setting ? setting.value : 'internal';
        lastFetch = now;
        // Sync to localStorage
        try { localStorage.setItem('radioplan_db_mode', cachedMode); } catch {}
    } catch (e) {
        console.warn("Failed to fetch DB mode from server", e);
        // Fallback to localStorage
        try {
            const localMode = localStorage.getItem('radioplan_db_mode');
            if (localMode) {
                cachedMode = localMode;
                console.log("Using localStorage db_mode:", localMode);
            } else {
                cachedMode = 'internal';
            }
        } catch {
            cachedMode = 'internal';
        }
    }
    return cachedMode;
};

const logMismatch = async (entityName, method, id, internalData, mysqlData, error = null) => {
    try {
        console.error(`DB MISMATCH [${entityName}.${method}]`, { id, internalData, mysqlData, error });
        
        // Rate Limiting Logic
        const now = Date.now();
        if (now - mismatchLogReset > 60000) {
            mismatchLogCount = 0;
            mismatchLogReset = now;
        }

        if (mismatchLogCount >= MAX_MISMATCH_LOGS_PER_MINUTE) {
            console.warn("Mismatch logging throttled (max per minute reached)");
            return;
        }

        mismatchLogCount++;

        // Direct create to avoid recursion
        await base44.entities.SystemLog.create({
            level: 'error',
            source: 'DualAdapter',
            message: `DB Mismatch: ${entityName}.${method}`,
            details: JSON.stringify({
                id,
                error: error ? error.message : 'Data Mismatch',
                internal_summary: internalData ? (Array.isArray(internalData) ? `Array(${internalData.length})` : 'Object') : 'null',
                mysql_summary: mysqlData ? (Array.isArray(mysqlData) ? `Array(${mysqlData.length})` : 'Object') : 'null',
                diff: error ? null : 'Content differs (check console)',
                api_error: error?.response?.data || error?.message
            })
        });
    } catch (e) {
        console.error("Failed to log mismatch", e);
    }
};

export class DualAdapter {
    constructor(entityName) {
        this.entityName = entityName;
        this.internal = new Base44Adapter(entityName);
        this.mysql = new MySQLAdapter(entityName);
    }

    async getMode() {
        // For SystemSetting/User, always use internal to avoid recursion loop or because they are platform-managed
        if (this.entityName === 'SystemSetting' || this.entityName === 'SystemLog' || this.entityName === 'User') return 'internal';
        return await getDbMode();
    }

    // --- READ OPERATIONS ---

    async list(sort, limit, skip) {
        const mode = await this.getMode();
        
        if (mode === 'mysql') return this.mysql.list(sort, limit, skip);
        
        // Default: Internal is source of truth
        const internalResult = await this.internal.list(sort, limit, skip);

        if (mode === 'parallel_read_write') {
            // Verify asynchronously with tolerance
            setTimeout(() => {
                this.mysql.list(sort, limit, skip)
                    .then(mysqlResult => {
                        // Allow 5% difference for timing tolerance
                        const diff = Math.abs(internalResult.length - mysqlResult.length);
                        const tolerance = Math.max(2, Math.floor(internalResult.length * 0.05));
                        
                        if (diff > tolerance) {
                            logMismatch(this.entityName, 'list', 'N/A', internalResult, mysqlResult);
                        }
                    })
                    .catch(err => {
                        // Only log if not a "table doesn't exist" error
                        if (!err.message?.includes("doesn't exist")) {
                            logMismatch(this.entityName, 'list', 'N/A', null, null, err);
                        }
                    });
            }, 100); // Small delay for write propagation
        }

        return internalResult;
    }

    async filter(query, sort, limit, skip) {
        const mode = await this.getMode();

        if (mode === 'mysql') return this.mysql.filter(query, sort, limit, skip);

        const internalResult = await this.internal.filter(query, sort, limit, skip);

        if (mode === 'parallel_read_write') {
            setTimeout(() => {
                this.mysql.filter(query, sort, limit, skip)
                    .then(mysqlResult => {
                        const diff = Math.abs(internalResult.length - mysqlResult.length);
                        const tolerance = Math.max(2, Math.floor(internalResult.length * 0.05));
                        
                        if (diff > tolerance) {
                            logMismatch(this.entityName, 'filter', JSON.stringify(query), internalResult, mysqlResult);
                        }
                    })
                    .catch(err => {
                        if (!err.message?.includes("doesn't exist")) {
                            logMismatch(this.entityName, 'filter', JSON.stringify(query), null, null, err);
                        }
                    });
            }, 100);
        }

        return internalResult;
    }

    async get(id) {
        const mode = await this.getMode();

        if (mode === 'mysql') return this.mysql.get(id);

        const internalResult = await this.internal.get(id);

        if (mode === 'parallel_read_write') {
            this.mysql.get(id)
                .then(mysqlResult => {
                    // Normalize for comparison (dates to strings, etc)
                    if (!_.isEqual(
                        JSON.parse(JSON.stringify(internalResult || {})), 
                        JSON.parse(JSON.stringify(mysqlResult || {}))
                    )) {
                        logMismatch(this.entityName, 'get', id, internalResult, mysqlResult);
                    }
                })
                .catch(err => logMismatch(this.entityName, 'get', id, null, null, err));
        }

        return internalResult;
    }

    // --- WRITE OPERATIONS ---

    async create(data) {
        // Prevent duplicates for ShiftEntry
        if (this.entityName === 'ShiftEntry' && data.date && data.position && data.doctor_id) {
            const dateStr = data.date instanceof Date ? data.date.toISOString().split('T')[0] : data.date;
            const existing = await this.filter({ 
                date: dateStr, 
                position: data.position, 
                doctor_id: data.doctor_id 
            });
            if (existing && existing.length > 0) {
                console.log(`[DualAdapter] Prevented duplicate create for ShiftEntry`, data);
                return existing[0];
            }
        }

        const mode = await this.getMode();

        if (mode === 'mysql') return this.mysql.create(data);

        // Always write to Internal first if not mysql-only
        const result = await this.internal.create(data);

        if (mode === 'parallel_write' || mode === 'parallel_read_write') {
            // Write to MySQL as well (fire and forget or await?)
            // Await to ensure consistency? No, user said "internal is leading". 
            // We should just try to write.
            try {
                // Ensure ID matches
                const payload = { ...data, id: result.id }; 
                await this.mysql.create(payload);
            } catch (e) {
                logMismatch(this.entityName, 'create', result.id, result, null, e);
            }
        }

        return result;
    }

    async update(id, data) {
        const mode = await this.getMode();

        if (mode === 'mysql') return this.mysql.update(id, data);

        const result = await this.internal.update(id, data);

        if (mode === 'parallel_write' || mode === 'parallel_read_write') {
            try {
                await this.mysql.update(id, data);
            } catch (e) {
                logMismatch(this.entityName, 'update', id, data, null, e);
            }
        }

        return result;
    }

    async delete(id) {
        const mode = await this.getMode();

        if (mode === 'mysql') return this.mysql.delete(id);

        const result = await this.internal.delete(id);

        if (mode === 'parallel_write' || mode === 'parallel_read_write') {
            try {
                await this.mysql.delete(id);
            } catch (e) {
                logMismatch(this.entityName, 'delete', id, null, null, e);
            }
        }

        return result;
    }

    async bulkCreate(data) {
        // Prevent duplicates for ShiftEntry
        let filteredData = data;
        if (this.entityName === 'ShiftEntry' && Array.isArray(data) && data.length > 0) {
            // Group by date to batch checks
            const byDate = {};
            data.forEach(item => {
                if (item.date && item.position && item.doctor_id) {
                    const d = item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date;
                    if (!byDate[d]) byDate[d] = [];
                    byDate[d].push(item);
                }
            });

            const uniqueDates = Object.keys(byDate);
            if (uniqueDates.length > 0) {
                // Check existing for these dates
                const existingBatches = await Promise.all(
                    uniqueDates.map(d => this.filter({ date: d }))
                );
                
                const existingMap = new Set();
                existingBatches.flat().forEach(s => {
                    existingMap.add(`${s.date}|${s.position}|${s.doctor_id}`);
                });

                filteredData = data.filter(item => {
                    const d = item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date;
                    const key = `${d}|${item.position}|${item.doctor_id}`;
                    if (existingMap.has(key)) return false; // Duplicate in DB
                    existingMap.add(key); // Add to map to prevent duplicates within the payload itself
                    return true;
                });

                if (filteredData.length < data.length) {
                    console.log(`[DualAdapter] Filtered ${data.length - filteredData.length} duplicates in bulkCreate`);
                }
                
                if (filteredData.length === 0) return [];
            }
        }

        const mode = await this.getMode();

        if (mode === 'mysql') return this.mysql.bulkCreate(filteredData);

        const result = await this.internal.bulkCreate(filteredData);

        if (mode === 'parallel_write' || mode === 'parallel_read_write') {
            try {
                // We need the IDs generated by internal if any? 
                // bulkCreate usually takes data with IDs or generates them.
                // Assuming data has IDs or Base44 returns them.
                // If Base44 generates IDs, we might have a mismatch if we let MySQL generate them.
                // Ideally, we should use the result from internal to feed MySQL.
                await this.mysql.bulkCreate(result); // result should be the array of created items
            } catch (e) {
                logMismatch(this.entityName, 'bulkCreate', 'batch', data, null, e);
            }
        }

        return result;
    }
}