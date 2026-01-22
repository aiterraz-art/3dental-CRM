import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { Database } from '../types/supabase';

export type Profile = Database['public']['Tables']['profiles']['Row'] & {
    supervisor_id?: string | null;
    status?: string | null;
    full_name?: string | null;
};

interface UserContextType {
    profile: Profile | null;
    loading: boolean;
    isSupervisor: boolean;
    impersonatedUser: Profile | null;
    impersonateUser: (email: string) => Promise<void>;
    stopImpersonation: () => void;
    effectiveRole: string | null;
    canImpersonate: boolean;
    realRole: string | null;
    isManager: boolean;
    isChief: boolean;
    isAdminOps: boolean;
    isSeller: boolean;
    isDriver: boolean;
    canUploadData: boolean;
    canViewMetas: boolean;
    hasPermission: (permission: string) => boolean;
    permissions: string[];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [impersonatedUser, setImpersonatedUser] = useState<Profile | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);

    const fetchPermissions = async (role: string) => {
        try {
            const { data, error } = await supabase
                .from('role_permissions')
                .select('permission')
                .eq('role', role);

            if (data && data.length > 0) {
                setPermissions(data.map(p => p.permission));
            } else {
                // FALLBACK DEFAULTS until migration is applied
                const defaults: Record<string, string[]> = {
                    'manager': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS'],
                    'jefe': ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_TEAM_STATS'],
                    'administrativo': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH'],
                    'seller': ['VIEW_METAS'],
                    'driver': ['EXECUTE_DELIVERY']
                };
                setPermissions(defaults[role] || []);
            }
        } catch (err) {
            console.error("Error fetching permissions:", err);
            setPermissions([]);
        }
    };

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    // 1. Try public schema (Priority)
                    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id);

                    if (data && data.length > 0) {
                        setProfile(data[0] as any as Profile);
                    } else {
                        // 2. Try CRM schema SILENTLY
                        let crmData = [];
                        try {
                            const { data: cData, error: cErr } = await (supabase.schema('crm').from('profiles') as any).select('*').eq('id', session.user.id);
                            if (cData && !cErr) crmData = cData;
                        } catch (e) {
                            console.warn('UserContext: CRM schema blocked');
                        }

                        if (crmData && crmData.length > 0) {
                            setProfile(crmData[0] as any as Profile);
                        } else {
                            // 3. Try Link by Email in public first
                            const { data: invitedData } = await supabase.from('profiles').select('*').eq('email', session.user.email).maybeSingle();

                            if (invitedData) {
                                console.log("UserContext: Linking invited user...");
                                await supabase.from('profiles').update({ id: session.user.id }).eq('email', session.user.email);
                                try {
                                    await (supabase.schema('crm').from('profiles') as any).update({ id: session.user.id }).eq('email', session.user.email);
                                } catch (e) { }
                                setProfile({ ...invitedData, id: session.user.id } as any as Profile);
                                return;
                            }

                            // 4. Create new profile in public
                            console.log("UserContext: Creating new profile...");
                            const profileData = {
                                id: session.user.id,
                                email: session.user.email,
                                role: 'seller',
                                status: 'active',
                                full_name: session.user.user_metadata?.full_name || ''
                            };

                            await supabase.from('profiles').insert(profileData);
                            try {
                                await (supabase.schema('crm').from('profiles') as any).insert(profileData);
                            } catch (e) { }
                            setProfile(profileData as any as Profile);
                        }
                    }
                }
            } catch (err) {
                console.error("UserContext: CRITICAL ERROR fetching profile:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) fetchProfile();
            else {
                setProfile(null);
                setImpersonatedUser(null);
                setLoading(false);
            }
        });

        return () => authListener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const role = (impersonatedUser || profile)?.role;
        if (role) {
            fetchPermissions(role);
        } else {
            setPermissions([]);
        }
    }, [profile?.role, impersonatedUser?.role]);

    const getRoleBase = (r: string | null | undefined) => (r || '').trim().toLowerCase();

    const baseRealRole = getRoleBase(profile?.role);
    const realRole = baseRealRole || null;

    // Effective profile is the impersonated one OR the real one
    const effectiveProfile = impersonatedUser || profile;
    const effectiveRole = getRoleBase(effectiveProfile?.role);

    const isManager = effectiveRole === 'manager';
    const isChief = effectiveRole === 'jefe';
    const isAdminOps = effectiveRole === 'administrativo';
    const isSeller = effectiveRole === 'seller';
    const isDriver = effectiveRole === 'driver';

    const isSupervisor = permissions.includes('VIEW_TEAM_STATS');
    const canImpersonate = permissions.includes('MANAGE_USERS');

    // Dynamic Permissions
    const hasPermission = (perm: string) => permissions.includes(perm);

    // Granular Permissions (Backward compatibility)
    const canUploadData = permissions.includes('UPLOAD_EXCEL');
    const canViewMetas = permissions.includes('VIEW_METAS');

    const impersonateUser = async (email: string) => {
        try {
            const { data, error } = await supabase.from('profiles').select('*').eq('email', email).single();
            if (data) {
                setImpersonatedUser(data as any as Profile);
                return;
            }
        } catch (err) {
            console.log("Could not fetch real profile for impersonation, falling back to mock.");
        }

        const mockProfiles: Record<string, Profile> = {
            'dcarvajal@3dental.cl': { id: '11111111-1111-1111-1111-111111111111', email: 'dcarvajal@3dental.cl', role: 'seller', full_name: 'Daniela Carvajal', zone: 'Santiago Centro' } as any,
            'nrigual@3dental.cl': { id: '22222222-2222-2222-2222-222222222222', email: 'nrigual@3dental.cl', role: 'seller', full_name: 'Natalia Rigual', zone: 'Las Condes' } as any,
            'jmena@3dental.cl': { id: '33333333-3333-3333-3333-333333333333', email: 'jmena@3dental.cl', role: 'driver', full_name: 'Juan Mena Reparto', zone: 'Logística' } as any
        };

        if (mockProfiles[email]) setImpersonatedUser(mockProfiles[email]);
    };

    const stopImpersonation = () => setImpersonatedUser(null);

    return (
        <UserContext.Provider value={{ profile: effectiveProfile, loading, isSupervisor, impersonatedUser, impersonateUser, stopImpersonation, effectiveRole, canImpersonate, realRole, isManager, isChief, isAdminOps, isSeller, isDriver, canUploadData, canViewMetas, hasPermission, permissions }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (context === undefined) throw new Error('useUser must be used within a UserProvider');
    return context;
};
