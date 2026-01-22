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
                    'manager': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS'],
                    'jefe': ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH'],
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
                console.log("UserContext: Session Check", session?.user?.id);

                if (session?.user) {
                    // Try to fetch from public view (which points to crm.profiles)
                    const { data, error } = await (supabase
                        .from('profiles') as any)
                        .select('*')
                        .eq('id', session.user.id);

                    if (data && data.length > 0) {
                        console.log("UserContext: Profile found in public view");
                        setProfile(data[0] as any as Profile);
                    } else {
                        console.log('UserContext: No profile in view, trying CRM schema...', error);
                        // Fallback to explicit crm schema if view fails
                        const { data: crmData } = await (supabase
                            .schema('crm')
                            .from('profiles') as any)
                            .select('*')
                            .eq('id', session.user.id);

                        if (crmData && crmData.length > 0) {
                            console.log("UserContext: Profile found in CRM schema");
                            setProfile(crmData[0] as any as Profile);
                        } else {
                            console.log("UserContext: Creating new profile...");
                            // Profile doesn't exist, create it in crm schema
                            const { data: newProfile, error: createError } = await (supabase
                                .schema('crm')
                                .from('profiles') as any)
                                .insert({
                                    id: session.user.id,
                                    email: session.user.email,
                                    role: 'seller', // Default role
                                    status: 'pending', // Default status
                                    full_name: session.user.user_metadata?.full_name || ''
                                })
                                .select();

                            if (createError) console.error("UserContext: Error creating profile", createError);

                            if (newProfile && newProfile.length > 0) {
                                setProfile(newProfile[0] as any as Profile);
                            } else {
                                console.warn("UserContext: Failed to create profile, using fallback dummy.");
                                // If everything fails, set a dummy profile.
                                // EMERGENCY BYPASS: Always allow super admin even if DB fails
                                const isSuperAdmin = session.user.email === 'aterraza@3dental.cl';
                                setProfile({
                                    id: session.user.id,
                                    email: session.user.email,
                                    role: isSuperAdmin ? 'manager' : 'seller',
                                    status: isSuperAdmin ? 'active' : 'pending',
                                    zone: null
                                } as any as Profile);
                            }
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

    const isSupervisor = ['admin', 'jefe', 'supervisor', 'manager'].includes(effectiveRole || '');
    const canImpersonate = ['admin', 'jefe', 'supervisor', 'manager'].includes(baseRealRole || '');

    // Dynamic Permissions
    const hasPermission = (perm: string) => permissions.includes(perm);

    // Granular Permissions (Backward compatibility)
    const canUploadData = permissions.includes('UPLOAD_EXCEL');
    const canViewMetas = permissions.includes('VIEW_METAS');

    const impersonateUser = async (email: string) => {
        // 1. Try to fetch real profile first
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('email', email)
                .single();

            if (data) {
                setImpersonatedUser(data as any as Profile);
                return;
            }
        } catch (err) {
            console.log("Could not fetch real profile for impersonation, falling back to mock.");
        }

        // 2. Fallback to Mock with VALID UUIDs
        const mockProfiles: Record<string, Profile> = {
            'dcarvajal@3dental.cl': {
                id: '11111111-1111-1111-1111-111111111111', // Valid UUID format
                email: 'dcarvajal@3dental.cl',
                role: 'seller',
                created_at: new Date().toISOString(),
                full_name: 'Daniela Carvajal',
                zone: 'Santiago Centro'
            } as any,
            'nrigual@3dental.cl': {
                id: '22222222-2222-2222-2222-222222222222', // Valid UUID format
                email: 'nrigual@3dental.cl',
                role: 'seller',
                created_at: new Date().toISOString(),
                full_name: 'Natalia Rigual',
                zone: 'Las Condes'
            } as any,
            'jmena@3dental.cl': {
                id: '33333333-3333-3333-3333-333333333333',
                email: 'jmena@3dental.cl',
                role: 'driver',
                created_at: new Date().toISOString(),
                full_name: 'Juan Mena Reparto',
                zone: 'Logística'
            } as any
        };

        if (mockProfiles[email]) {
            setImpersonatedUser(mockProfiles[email]);
            // Attempt to insert shadow profile if it doesn't exist (optional, risky if strict auth FK)
            // For now, we assume if it wasn't found, we just use the mock in memory.
            // If the DB has foreign key constraints on 'seller_id' to 'auth.users', this mock ID will fail on insert.
        } else {
            console.warn(`Profile for ${email} not found in mocks.`);
        }
    };

    const stopImpersonation = () => {
        setImpersonatedUser(null);
    };

    return (
        <UserContext.Provider value={{
            profile: effectiveProfile, // Return effective profile directly
            loading,
            isSupervisor,
            impersonatedUser,
            impersonateUser,
            stopImpersonation,
            effectiveRole,
            canImpersonate,
            realRole,
            isManager,
            isChief,
            isAdminOps,
            isSeller,
            isDriver,
            canUploadData,
            canViewMetas,
            hasPermission,
            permissions
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
};
