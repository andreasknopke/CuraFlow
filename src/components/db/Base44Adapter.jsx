import { base44 } from '@/api/base44Client';

export class Base44Adapter {
  constructor(entityName) {
    this.entity = base44.entities[entityName];
    if (!this.entity) {
        console.warn(`Entity ${entityName} not found in Base44 SDK`);
    }
  }
  
  async list(sort, limit) { 
      return this.entity.list(sort, limit); 
  }
  
  async filter(query, sort, limit) { 
      return this.entity.filter(query, sort, limit); 
  }
  
  async get(id) { 
      try {
          if (this.entity.get) return await this.entity.get(id);
          const res = await this.entity.filter({id}, null, 1);
          return res[0];
      } catch (e) {
          throw e;
      }
  }
  
  async create(data) { 
      return this.entity.create(data); 
  }
  
  async update(id, data) { 
      return this.entity.update(id, data); 
  }
  
  async delete(id) { 
      return this.entity.delete(id); 
  }
  
  async bulkCreate(data) { 
      return this.entity.bulkCreate(data); 
  }
}