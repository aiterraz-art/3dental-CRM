import { supabase } from './supabase';
import { Database } from '../types/supabase';

type Client = Database['public']['Tables']['clients']['Row'];
type ClientInsert = Database['public']['Tables']['clients']['Insert'];

export const clientService = {
    async getClients() {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .order('name');
        if (error) throw error;
        return (data as any) as Client[];
    },

    async createClient(client: ClientInsert) {
        const { data, error } = await (supabase.from('clients') as any)
            .insert(client)
            .select() // Return the inserted data so we can update state immediately
            .single();
        if (error) throw error;
        return data as Client;
    },

    async insertMockData() {
        const mockClients: ClientInsert[] = [
            {
                name: "Bright Dental Clinic",
                address: "123 Smile Way",
                lat: -34.6037,
                lng: -58.3816,
                status: "active",
                last_visit_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
                zone: "Zone A"
            },
            {
                name: "White Teeth Center",
                address: "456 Tooth Lane",
                lat: -34.6137,
                lng: -58.3716,
                status: "high_priority",
                last_visit_date: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
                zone: "Zone A"
            },
            {
                name: "Family Oral Care",
                address: "789 Gum St",
                lat: -34.5937,
                lng: -58.3916,
                status: "active",
                last_visit_date: new Date().toISOString(),
                zone: "Zone A"
            }
        ];

        const { error } = await (supabase.from('clients') as any).insert(mockClients);
        if (error) console.error("Error inserting mock data:", error);
    }
};
