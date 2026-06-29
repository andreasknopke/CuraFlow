-- Create pool_ward_demand table for cross-tenant Springerpool Bedarf.
-- Ward staff can register demand for a float-pool nurse on a specific
-- date+timeslot. The pool scheduler sees demands in their tenant and
-- can fulfil them by assigning a rotation to that cell.
-- Idempotent: CREATE TABLE IF NOT EXISTS.

SET @dbname = DATABASE();
SET @tableExists = (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pool_ward_demand');

SET @sql = IF(@tableExists = 0,
  'CREATE TABLE pool_ward_demand (
     id VARCHAR(36) PRIMARY KEY,
     shared_workplace_id VARCHAR(36) NOT NULL,
     group_id INT NOT NULL,
     ward_tenant_id VARCHAR(36) NOT NULL,
     date DATE NOT NULL,
     timeslot_id VARCHAR(36) DEFAULT NULL,
     note TEXT DEFAULT NULL,
     status VARCHAR(32) NOT NULL DEFAULT ''open'',
     fulfilled_by_shift_id VARCHAR(36) DEFAULT NULL,
     created_by VARCHAR(255) DEFAULT NULL,
     created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
     updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
     INDEX idx_demand_status (status),
     INDEX idx_demand_workplace_date (shared_workplace_id, date),
     INDEX idx_demand_ward (ward_tenant_id, date),
     INDEX idx_demand_fulfilled (fulfilled_by_shift_id),
     CONSTRAINT fk_demand_workplace FOREIGN KEY (shared_workplace_id)
       REFERENCES shared_workplace(id) ON DELETE CASCADE,
     CONSTRAINT fk_demand_group FOREIGN KEY (group_id)
       REFERENCES tenant_group(id) ON DELETE CASCADE
   ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT "Table pool_ward_demand already exists" AS status');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
