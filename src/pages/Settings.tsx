import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Shield, User, Search, CheckCircle, Ban, Edit, Save } from 'lucide-react';
import { Profile } from '../contexts/UserContext';

const Settings: React.FC = () => {
    const { profile, isSupervisor } = useUser();
    const [users, setUsers] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    // Temporary state for editing
    const [tempRole, setTempRole] = useState<string>('');
    const [tempStatus, setTempStatus] = useState<string>('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        // Fetch all profiles. NOTE: RLS policy must allow this for admins.
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('email');

        if (error) {
            console.error('Error fetching users:', error);
            alert('Error al cargar usuarios. Verifica que tengas permisos de Administrador.');
        } else {
            setUsers(data as Profile[] || []);
        }
        setLoading(false);
    };

    const handleEdit = (user: Profile) => {
        if (user.email === 'aterraza@3dental.cl') {
            alert("No se puede editar al Super Admin.");
            return;
        }
        setEditingId(user.id);
        setTempRole(user.role || 'user');
        setTempStatus(user.status || 'pending');
    };

    const handleSave = async (id: string) => {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ role: tempRole, status: tempStatus })
                .eq('id', id);

            if (error) throw error;

            alert('Usuario actualizado correctamente.');
            setEditingId(null);
            fetchUsers(); // Refresh list
        } catch (error: any) {
            console.error('Error updating user:', error);
            alert('Error al actualizar: ' + error.message);
        }
    };

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Shield size={64} className="mb-4 text-red-400" />
                <h2 className="text-2xl font-bold">Acceso Denegado</h2>
                <p>Solo los administradores pueden ver esta página.</p>
            </div>
        );
    }

    const filteredUsers = users.filter(u =>
        (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (u.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div>
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">Configuración del Sistema</h2>
                <p className="text-gray-400 font-medium mt-1 text-lg">Gestión de usuarios y permisos</p>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                <div className="p-8 border-b border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
                    <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <User className="text-indigo-600" />
                        Usuarios Registrados
                    </h3>
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl font-medium focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-wider">Usuario</th>
                                <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-wider">Rol</th>
                                <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-wider">Estado</th>
                                <th className="px-8 py-4 text-right text-xs font-black text-gray-400 uppercase tracking-wider">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Cargando usuarios...</td></tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">No se encontraron usuarios.</td></tr>
                            ) : (
                                filteredUsers.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-8 py-4">
                                            <div className="flex items-center">
                                                <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold mr-3">
                                                    {user.email?.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-900">{user.email}</p>
                                                    <p className="text-xs text-gray-400">{user.id.slice(0, 8)}...</p>
                                                </div>
                                            </div>
                                        </td>

                                        <td className="px-8 py-4">
                                            {editingId === user.id ? (
                                                <select
                                                    value={tempRole}
                                                    onChange={(e) => setTempRole(e.target.value)}
                                                    className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5"
                                                >
                                                    <option value="manager">Manager (Admin)</option>
                                                    <option value="seller">Vendedor</option>
                                                    <option value="driver">Repartidor (Driver)</option>
                                                </select>
                                            ) : (
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase
                          ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                                                        user.role === 'driver' ? 'bg-amber-100 text-amber-700' :
                                                            user.role === 'seller' ? 'bg-green-100 text-green-700' :
                                                                'bg-gray-100 text-gray-600'}`}>
                                                    {user.role || 'Sin Rol'}
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-8 py-4">
                                            {editingId === user.id ? (
                                                <select
                                                    value={tempStatus}
                                                    onChange={(e) => setTempStatus(e.target.value)}
                                                    className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5"
                                                >
                                                    <option value="pending">Pendiente</option>
                                                    <option value="active">Activo</option>
                                                    <option value="suspended">Suspendido</option>
                                                </select>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    {user.status === 'active' ? (
                                                        <><CheckCircle size={16} className="text-green-500" /><span className="text-green-700 font-bold text-sm">Activo</span></>
                                                    ) : (
                                                        <><Ban size={16} className="text-red-400" /><span className="text-red-500 font-bold text-sm">{user.status === 'pending' ? 'Pendiente' : 'Suspendido'}</span></>
                                                    )}
                                                </div>
                                            )}
                                        </td>

                                        <td className="px-8 py-4 text-right">
                                            {editingId === user.id ? (
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => setEditingId(null)} className="p-2 text-gray-400 hover:text-gray-600 font-bold text-sm">Cancelar</button>
                                                    <button onClick={() => handleSave(user.id)} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1">
                                                        <Save size={16} /> Guardar
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleEdit(user)}
                                                    disabled={user.email === 'aterraza@3dental.cl'} // Hardcoded protection
                                                    className="text-indigo-600 hover:text-indigo-800 font-bold text-sm flex items-center justify-end w-full gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                                >
                                                    <Edit size={16} /> Editar
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Settings;
