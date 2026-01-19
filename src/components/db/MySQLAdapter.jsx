import { base44 } from '@/api/base44Client';

export class MySQLAdapter {
  constructor(entityName) {
    this.entityName = entityName;
  }
  
  async invoke(action, payload = {}) {
      const creds = localStorage.getItem('db_credentials');
      const res = await base44.functions.invoke('dbProxy', {
          action,
          entity: this.entityName,
          _credentials: creds,
          ...payload
      });
      return res.data;
  }
  
  async list(sort, limit, skip) { 
      return this.invoke('list', { sort, limit, skip });
  }
  
  async filter(query, sort, limit, skip) { 
      return this.invoke('filter', { query, sort, limit, skip });
  }
  
  async get(id) { 
      return this.invoke('get', { id });
  }
  
  async create(data) { 
      return this.invoke('create', { data });
  }
  
  async update(id, data) { 
      return this.invoke('update', { id, data });
  }
  
  async delete(id) { 
      return this.invoke('delete', { id });
  }
  
  async bulkCreate(data) { 
      return this.invoke('bulkCreate', { data });
  }
}