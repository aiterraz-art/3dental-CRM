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
        const defaults: Record<string, string[]> = {
            'manager': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS'],
            'admin': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS'],
            'jefe': ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_TEAM_STATS'],
            'administrativo': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH'],
            'seller': ['VIEW_METAS'],
            'driver': ['EXECUTE_DELIVERY']
        };

        // NUCLEAR BYPASS: If current user is owner, give EVERYTHING regardless of DB
        if (profile?.email === 'aterraza@3dental.cl') {
            console.log("UserContext: Owner nuclear bypass applied to permissions.");
            setPermissions(defaults['admin']);
            return;
        }

        try {
            const { data, error } = await supabase.from('role_permissions').select('permission').eq('role', role);
            console.log(`UserContext DB Perms (${role}):`, { data, error });

            if (error || !data || data.length === 0) {
                console.warn(`UserContext: Using default permissions for ${role}`);
                const fallback = defaults[role] || [];
                console.log(`UserContext Fallback (${role}):`, fallback);
                setPermissions(fallback);
                return;
            }

            const perms = data.map(p => p.permission);
            console.log(`UserContext Final Perms (${role}):`, perms);
            setPermissions(perms);
        } catch (err) {
            console.error("Error fetching permissions, using fallbacks:", err);
            setPermissions(defaults[role] || []);
        }
    };

    const fetchProfile = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                // 1. PRIMARY SOURCE: public.profiles
                const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id);

                if (data && data.length > 0) {
                    setProfile(data[0] as any as Profile);
                } else if (session.user.email === 'aterraza@3dental.cl') {
                    // EMERGENCY BYPASS: Force admin profile for system owner if DB fetch fails
                    console.warn("UserContext: EMERGENCY BYPASS triggered for owner.");
                    const ownerProfile = {
                        id: session.user.id,
                        email: session.user.email,
                        role: 'admin',
                        status: 'active',
                        full_name: 'Super Admin (Bypass)'
                    };
                    setProfile(ownerProfile as any as Profile);
                } else {
                    // 2. SECONDARY: Check if invited (by email in public.profiles)
                    const { data: invitedData } = await supabase.from('profiles').select('*').eq('email', session.user.email).maybeSingle();

                    if (invitedData) {
                        console.log("UserContext: Linking invited user...");
                        await supabase.from('profiles').update({ id: session.user.id }).eq('email', session.user.email);
                        setProfile({ ...invitedData, id: session.user.id } as any as Profile);
                    } else {
                        // 3. AUTO-CREATION: Baseline profile
                        const newProfile = {
                            id: session.user.id,
                            email: session.user.email,
                            role: 'seller',
                            status: 'active',
                            full_name: session.user.user_metadata?.full_name || ''
                        };
                        await supabase.from('profiles').insert(newProfile);
                        setProfile(newProfile as any as Profile);
                    }
                }
            }
        } catch (err) {
            console.error("UserContext: Profile Load Error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
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
        if (role) fetchPermissions(role);
        else setPermissions([]);
    }, [profile?.role, impersonatedUser?.role]);

    const getRoleBase = (r: string | null | undefined) => (r || '').trim().toLowerCase();
    const effectiveProfile = impersonatedUser || profile;
    const effectiveRole = getRoleBase(effectiveProfile?.role);

    const isManager = effectiveRole === 'manager' || effectiveRole === 'admin';
    const isChief = effectiveRole === 'jefe';
    const isAdminOps = effectiveRole === 'administrativo';
    const isSeller = effectiveRole === 'seller';
    const isDriver = effectiveRole === 'driver';
    const isSupervisor = permissions.includes('VIEW_TEAM_STATS');
    const bCanImpersonate = permissions.includes('MANAGE_USERS');
    const bHasPermission = (perm: string) => permissions.includes(perm);
    const bCanUploadData = permissions.includes('UPLOAD_EXCEL');
    const bCanViewMetas = permissions.includes('VIEW_METAS');

    return (
        <UserContext.Provider value={{
            profile: effectiveProfile, loading, isSupervisor, impersonatedUser, impersonateUser: async (email: string) => {
                const { data } = await supabase.from('profiles').select('*').eq('email', email).single();
                if (data) setImpersonatedUser(data as any as Profile);
            }, stopImpersonation: () => setImpersonatedUser(null), effectiveRole, canImpersonate: bCanImpersonate, realRole: getRoleBase(profile?.role) || null, isManager, isChief, isAdminOps, isSeller, isDriver, canUploadData: bCanUploadData, canViewMetas: bCanViewMetas, hasPermission: bHasPermission, permissions
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (context === undefined) throw new Error('useUser must be used within a UserProvider');
    return context;
};
