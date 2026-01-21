import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MapPin, ChevronRight, Filter, Phone, Mail, CheckCircle2, Trash2, Building2, Pencil, Send, Paperclip, X, FileText, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { Database } from '../types/supabase';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { APIProvider, Map, AdvancedMarker, Pin, useMapsLibrary } from '@vis.gl/react-google-maps';
import ClientDetailModal from '../components/modals/ClientDetailModal';

type Client = Database['public']['Tables']['clients']['Row'];

// Google Maps Setup
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };

const normalizeRut = (rut: string): string => {
    // 1. Remove non-alphanumeric
    let clean = rut.replace(/[^0-9kK]/g, '');
    if (clean.length < 2) return clean;

    // 2. Identify body and dv
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();

    // 3. Format with hyphen
    return `${body}-${dv}`;
};

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
};

const deg2rad = (deg: number) => {
    return deg * (Math.PI / 180);
};

const ClientsContent = () => {
    const { profile } = useUser();
    const navigate = useNavigate();
    const [clients, setClients] = useState<Client[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [profiles, setProfiles] = useState<any[]>([]);

    // Client 360 View State
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);

    // Client Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Email Modal State
    const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailData, setEmailData] = useState({
        to: '',
        cc: '',
        subject: '',
        message: '',
        clientName: '',
        clientId: ''
    });
    const [attachment, setAttachment] = useState<File | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);

    const [viewMode, setViewMode] = useState<'all' | 'mine'>('all'); // For Admins

    // New/Edit Client Form State
    const [clientForm, setClientForm] = useState({
        name: '',
        rut: '',
        phone: '',
        email: '',
        address: '',
        lat: SANTIAGO_CENTER.lat,
        lng: SANTIAGO_CENTER.lng,
        notes: '',
        giro: '',
        comuna: ''
    });

    // Maps State for Modal
    const [manualLocation, setManualLocation] = useState<{ lat: number; lng: number } | null>(null);

    // Places Autocomplete Setup
    const placesLib = useMapsLibrary('places');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!placesLib || !inputRef.current || !isModalOpen) return;

        const autocomplete = new placesLib.Autocomplete(inputRef.current, {
            fields: ['geometry', 'formatted_address', 'address_components'],
            componentRestrictions: { country: 'cl' }
        });

        const listener = autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();

            if (place.geometry?.location && place.formatted_address) {
                const lat = place.geometry.location.lat();
                const lng = place.geometry.location.lng();

                let comuna = '';

                // Strategy 1: Extract from formatted_address (User suggestion: "After Zip Code")
                // Matches 7-digit Zip followed by Comuna name until comma
                const zipMatch = place.formatted_address?.match(/(\d{7})\s+([^,]+)/);
                if (zipMatch && zipMatch[2]) {
                    comuna = zipMatch[2].trim();
                } else {
                    // Strategy 2: Fallback to Address Components if no Zip pattern found
                    const comunaComponent = place.address_components?.find(c => c.types.includes('administrative_area_level_3'))
                        || place.address_components?.find(c => c.types.includes('sublocality'))
                        || place.address_components?.find(c => c.types.includes('sublocality_level_1'))
                        || place.address_components?.find(c => c.types.includes('locality'));

                    comuna = comunaComponent?.long_name || '';
                }

                setClientForm(prev => ({
                    ...prev,
                    address: place.formatted_address || prev.address,
                    lat,
                    lng,
                    comuna
                }));
                // Also update the map and manual pin to this location
                setManualLocation({ lat, lng });
            }
        });

        return () => {
            google.maps.event.removeListener(listener);
            google.maps.event.clearInstanceListeners(autocomplete);
        };
    }, [placesLib, isModalOpen]);

    // Initial Fetch
    const fetchClients = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .order('name');

        if (error) console.error("Error fetching clients:", error);
        if (data) setClients(data);
        setLoading(false);
    };

    const fetchProfiles = async () => {
        const { data } = await supabase.from('profiles').select('id, email, full_name');
        if (data) setProfiles(data);
    };

    useEffect(() => {
        fetchClients();
        fetchProfiles();
    }, []);

    const handleOpenModal = (clientToEdit?: Client) => {
        if (clientToEdit) {
            setIsEditing(clientToEdit.id);
            setClientForm({
                name: clientToEdit.name,
                rut: clientToEdit.rut || '',
                phone: clientToEdit.phone || '',
                email: clientToEdit.email || '',
                address: clientToEdit.address || '',
                lat: clientToEdit.lat ?? SANTIAGO_CENTER.lat,
                lng: clientToEdit.lng ?? SANTIAGO_CENTER.lng,
                notes: clientToEdit.notes || '',
                giro: clientToEdit.giro || '',
                comuna: clientToEdit.comuna || ''
            });
            if (clientToEdit.lat && clientToEdit.lng) {
                setManualLocation({ lat: clientToEdit.lat, lng: clientToEdit.lng });
            } else {
                setManualLocation(null);
            }
        } else {
            setIsEditing(null);
            setClientForm({
                name: '',
                rut: '',
                phone: '',
                email: '',
                address: '',
                lat: SANTIAGO_CENTER.lat,
                lng: SANTIAGO_CENTER.lng,
                notes: '',
                giro: '',
                comuna: ''
            });
            setManualLocation(null);
        }
        setIsModalOpen(true);
    };

    const handleOpenEmailModal = (client: Client) => {
        setEmailData({
            to: client.email || '',
            cc: '',
            subject: `Cotización Dental - ${client.name}`,
            message: `Estimados ${client.name},\n\nAdjunto lo solicitado.\n\nSaludos cordiales,\n${(profile as any)?.full_name || 'Dr. Alfredo Terraza'}`,
            clientName: client.name,
            clientId: client.id
        });
        setAttachment(null);
        setIsEmailModalOpen(true);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.size > 20 * 1024 * 1024) { // 20MB limit
                alert('⚠️ El archivo es muy pesado. Máximo 20MB.');
                return;
            }
            setAttachment(file);
        }
    };

    const handleSendGmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setSendingEmail(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const providerToken = session?.provider_token;

            if (!providerToken) {
                alert('⚠️ No se detectó una sesión de Google activa con permisos de envío. Por favor, cierra sesión y vuelve a ingresar con Google.');
                setSendingEmail(false);
                return;
            }

            // MIME boundary
            const boundary = "foo_bar_baz";

            // Build the MIME message parts
            let messageParts = [
                `From: ${session.user.email}`,
                `To: ${emailData.to}`,
                emailData.cc ? `Cc: ${emailData.cc}` : null,
                `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(emailData.subject)))}?=`,
                'MIME-Version: 1.0',
                `Content-Type: multipart/mixed; boundary="${boundary}"`,
                '',
                `--${boundary}`,
                'Content-Type: text/plain; charset="UTF-8"',
                'Content-Transfer-Encoding: 7bit',
                '',
                emailData.message,
                ''
            ];

            // Add attachment if present
            if (attachment) {
                const reader = new FileReader();
                await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(attachment);
                });

                const base64Data = (reader.result as string).split(',')[1];

                messageParts.push(
                    `--${boundary}`,
                    `Content-Type: ${attachment.type}; name="${attachment.name}"`,
                    `Content-Disposition: attachment; filename="${attachment.name}"`,
                    'Content-Transfer-Encoding: base64',
                    '',
                    base64Data,
                    ''
                );
            }

            // Close boundary
            messageParts.push(`--${boundary}--`);

            // Join with CRLF for RFC compliance
            const rawMimeMessage = messageParts
                .filter(part => part != null)
                .join('\r\n');

            // Encode to Web-Safe Base64
            const encodedMessage = btoa(unescape(encodeURIComponent(rawMimeMessage)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            // Send via Standard Gmail API
            const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    raw: encodedMessage
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error?.message || 'Error al enviar correo. Verifica tus permisos de Google.');
            }

            // LOG THE EMAIL
            await supabase.from('email_logs').insert({
                client_id: emailData.clientId,
                user_id: profile?.id,
                subject: emailData.subject,
                snippet: emailData.message.substring(0, 100) + '...'
            });

            alert('¡Correo enviado exitosamente!');
            setIsEmailModalOpen(false);

        } catch (error: any) {
            console.error('Error sending email:', error);
            alert(`Error: ${error.message} `);
        } finally {
            setSendingEmail(false);
        }
    };

    const handleSaveClient = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        const normalizedRut = normalizeRut(clientForm.rut);

        if (!clientForm.name || !normalizedRut || !clientForm.email || !clientForm.phone || !clientForm.address || !clientForm.giro) {
            alert("⚠️ Todos los campos son obligatorios (Nombre, RUT, Email, Teléfono, Dirección, Giro), excepto las Notas.");
            setSubmitting(false);
            return;
        }

        try {
            if (isEditing) {
                const { error } = await supabase
                    .from('clients')
                    .update({
                        name: clientForm.name,
                        rut: normalizedRut,
                        phone: clientForm.phone,
                        email: clientForm.email,
                        address: clientForm.address,
                        lat: manualLocation ? manualLocation.lat : clientForm.lat,
                        lng: manualLocation ? manualLocation.lng : clientForm.lng,
                        notes: clientForm.notes,
                        giro: clientForm.giro,
                        comuna: clientForm.comuna
                    })
                    .eq('id', isEditing);

                if (error) throw error;
                alert('¡Cliente actualizado exitosamente!');

            } else {
                const { data: ownershipData, error: rpcError } = await supabase
                    .rpc('check_client_ownership', { check_rut: normalizedRut });

                if (rpcError) throw rpcError;
                if (ownershipData && ownershipData.length > 0) {
                    const owner = ownershipData[0].owner_name;
                    alert(`⚠️ Error: Este cliente ya existe.\n\nEstá asignado a: ${owner} \n\nNo puedes crear duplicados.`);
                    setSubmitting(false);
                    return;
                }

                const { error: insertError } = await supabase
                    .from('clients')
                    .insert({
                        id: crypto.randomUUID(),
                        name: clientForm.name,
                        rut: normalizedRut,
                        phone: clientForm.phone,
                        email: clientForm.email,
                        address: clientForm.address,
                        lat: manualLocation ? manualLocation.lat : clientForm.lat,
                        lng: manualLocation ? manualLocation.lng : clientForm.lng,
                        notes: clientForm.notes,
                        created_by: profile?.id,
                        status: 'active',
                        zone: 'Santiago',
                        giro: clientForm.giro,
                        comuna: clientForm.comuna
                    });

                if (insertError) throw insertError;
                alert('¡Cliente creado exitosamente!');
            }

            setIsModalOpen(false);
            fetchClients();

        } catch (error: any) {
            console.error('Error saving client:', error);
            alert(`Error: ${error.message} `);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`¿Estás seguro de eliminar a ${name}?\n\nEsta acción es irreversible y borrará todo su historial.`)) return;
        try {
            const { error } = await supabase.from('clients').delete().eq('id', id);
            if (error) throw error;
            fetchClients();
        } catch (error: any) {
            alert(`Error al eliminar: ${error.message} `);
        }
    };

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImporting(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                let successCount = 0;
                let errorCount = 0;
                let errors: string[] = [];

                if (rows.length === 0) {
                    alert('El archivo CSV está vacío.');
                    setImporting(false);
                    return;
                }

                if (profile?.role !== 'admin') {
                    alert("Acceso denegado: Solo los administradores pueden importar clientes masivos.");
                    setImporting(false);
                    return;
                }

                // Prepare data for bulk insert
                const clientsToInsert: any[] = [];

                for (const row of rows) {
                    // Map CSV headers to DB columns
                    const name = row['Nombre']?.trim();
                    const rut = row['Rut'] ? normalizeRut(row['Rut']) : null;
                    const giro = row['Giro']?.trim();
                    const address = row['Dirección']?.trim();
                    const comuna = row['Comuna']?.trim() || row['Ciudad']?.trim();
                    const phone = row['Teléfono']?.trim();
                    const email = row['Email']?.trim();
                    const purchase_contact = row['Contacto']?.trim();
                    const sellerEmail = row['Vendedor']?.trim();

                    if (!name) {
                        errorCount++;
                        errors.push(`Fila sin nombre: ${JSON.stringify(row)}`);
                        continue;
                    }

                    // Resolve Seller
                    let assignedSellerId = profile?.id; // Default to current user
                    if (sellerEmail) {
                        const foundProfile = profiles.find(p => p.email?.toLowerCase() === sellerEmail.toLowerCase());
                        if (foundProfile) {
                            assignedSellerId = foundProfile.id;
                        } else {
                            const foundProfileByUsername = profiles.find(p => p.email?.split('@')[0].toLowerCase() === sellerEmail.toLowerCase());
                            if (foundProfileByUsername) {
                                assignedSellerId = foundProfileByUsername.id;
                            } else {
                                errors.push(`Vendedor no encontrado: ${sellerEmail} (Asignando a ti por defecto)`);
                            }
                        }
                    }

                    clientsToInsert.push({
                        id: crypto.randomUUID(),
                        name: name,
                        rut: rut,
                        giro: giro,
                        address: address || 'Dirección por actualizar',
                        comuna: comuna,
                        phone: phone,
                        email: email,
                        purchase_contact: purchase_contact,
                        created_by: assignedSellerId,
                        status: 'active',
                        zone: 'Santiago',
                        lat: SANTIAGO_CENTER.lat,
                        lng: SANTIAGO_CENTER.lng,
                        notes: 'Importado vía CSV'
                    });
                }

                if (clientsToInsert.length > 0) {
                    // Bulk insert with check
                    for (const client of clientsToInsert) {
                        try {
                            if (client.rut) {
                                const { data: dup } = await supabase.from('clients').select('id').eq('rut', client.rut).single();
                                if (dup) {
                                    errorCount++;
                                    errors.push(`RUT duplicado: ${client.rut} (${client.name})`);
                                    continue;
                                }
                            }

                            const { error } = await supabase.from('clients').insert(client);
                            if (error) throw error;
                            successCount++;
                        } catch (err: any) {
                            errorCount++;
                            errors.push(`Error al insertar ${client.name}: ${err.message}`);
                        }
                    }
                }

                alert(`Importación Finalizada.\n\n✅ Exitosos: ${successCount}\n❌ Errores: ${errorCount}\n\n${errorCount > 0 ? 'Revisa la consola para detalles de errores.' : ''}`);
                if (errors.length > 0) console.error("CSV Import Errors:", errors);

                setImporting(false);
                if (csvInputRef.current) csvInputRef.current.value = '';
                fetchClients();
            },
            error: (err) => {
                console.error("CSV Parse Error:", err);
                alert("Error al leer el archivo CSV.");
                setImporting(false);
            }
        });
    };

    const filteredClients = clients.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.rut?.toLowerCase().includes(search.toLowerCase()) ||
            (c.address?.toLowerCase().includes(search.toLowerCase()) ?? false);

        const isOwner = c.created_by === profile?.id;
        const isAdmin = profile?.role === 'admin';

        if (isAdmin) {
            return (viewMode === 'all' || isOwner) && matchesSearch;
        }
        return isOwner && matchesSearch;
    });

    return (
        <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 leading-tight">Gestión de Clientes</h2>
                    <p className="text-gray-500 font-medium mt-1">
                        {profile?.role === 'admin' ? 'Administración total de la cartera' : 'Tu cartera de clientes asignada'}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {profile?.role === 'admin' && (
                        <div className="flex bg-gray-100 p-1 rounded-xl">
                            <button
                                onClick={() => setViewMode('all')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Todos
                            </button>
                            <button
                                onClick={() => setViewMode('mine')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'mine' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Mis Clientes
                            </button>
                        </div>
                    )}

                    {profile?.role === 'admin' && (
                        <>
                            <input
                                type="file"
                                accept=".csv"
                                ref={csvInputRef}
                                onChange={handleCSVUpload}
                                className="hidden"
                            />
                            <button
                                onClick={() => csvInputRef.current?.click()}
                                disabled={importing}
                                className="bg-indigo-50 text-indigo-600 px-4 py-4 rounded-2xl font-bold flex items-center hover:bg-indigo-100 transition-all text-sm disabled:opacity-50"
                                title="Importar CSV"
                            >
                                {importing ? (
                                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent animate-spin rounded-full mr-2"></div>
                                ) : (
                                    <Upload size={18} className="mr-2" />
                                )}
                                {importing ? '...' : 'Importar'}
                            </button>
                        </>
                    )}

                    <button
                        onClick={() => handleOpenModal()}
                        className="bg-gray-900 text-white px-6 py-4 rounded-2xl font-bold flex items-center shadow-lg hover:bg-black active:scale-95 transition-all text-sm"
                    >
                        <Plus size={18} className="mr-2" />
                        Nuevo Cliente
                    </button>
                </div>
            </div>

            <div className="relative max-w-2xl">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Buscar por nombre, RUT o dirección..."
                    className="w-full pl-14 pr-6 py-5 bg-white border-none rounded-[2rem] shadow-sm ring-1 ring-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-700 font-medium placeholder:text-gray-400"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white h-64 rounded-[2.5rem] animate-pulse"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredClients.map((client) => {
                        const isOwner = client.created_by === profile?.id;

                        return (
                            <div key={client.id} className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col justify-between min-h-[340px]">
                                <div className="space-y-6 cursor-pointer" onClick={() => setSelectedClient(client)}>
                                    <div className="flex justify-between items-start">
                                        <div className="w-16 h-16 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-inner">
                                            <Building2 size={28} />
                                        </div>
                                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                            {(profile?.role === 'admin' || isOwner) && (
                                                <>
                                                    <button
                                                        onClick={() => handleOpenModal(client)}
                                                        className="p-3 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                                        title="Editar Cliente"
                                                    >
                                                        <Pencil size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(client.id, client.name)}
                                                        className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                                        title="Eliminar Cliente"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-black text-gray-900 leading-tight mb-2 line-clamp-2">{client.name}</h3>
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{normalizeRut(client.rut || '') || 'SIN RUT'}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {client.address && (
                                            <div className="flex items-start text-xs text-gray-500 font-medium bg-gray-50 p-3 rounded-xl">
                                                <MapPin size={14} className="mr-2 mt-0.5 text-indigo-500 shrink-0" />
                                                <span className="line-clamp-2">{client.address}</span>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
                                            {client.phone && (
                                                <a
                                                    href={`tel:${client.phone} `}
                                                    className="flex items-center text-[10px] text-gray-500 font-bold bg-gray-50 px-3 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors cursor-pointer"
                                                >
                                                    <Phone size={12} className="mr-2 text-emerald-500" />
                                                    {client.phone}
                                                </a>
                                            )}
                                            {client.email && (
                                                <button
                                                    onClick={() => handleOpenEmailModal(client)}
                                                    className="flex items-center text-[10px] text-gray-500 font-bold bg-gray-50 px-3 py-2 rounded-lg tooltip hover:bg-blue-50 hover:text-blue-600 transition-colors cursor-pointer w-full text-left"
                                                    title={`Enviar correo a ${client.email} `}
                                                >
                                                    <Mail size={12} className="mr-2 text-blue-500 shrink-0" />
                                                    <span className="truncate">{client.email}</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 mt-4 border-t border-gray-50 flex gap-3" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`, '_blank')}
                                        className="p-4 bg-gray-50 text-gray-400 rounded-2xl hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                        title="Ver en Mapa"
                                    >
                                        <MapPin size={20} />
                                    </button >
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (!navigator.geolocation) {
                                                alert("Tu navegador no soporta geolocalización.");
                                                return;
                                            }
                                            navigator.geolocation.getCurrentPosition(
                                                (position) => {
                                                    const userLat = position.coords.latitude;
                                                    const userLng = position.coords.longitude;
                                                    const dist = getDistanceFromLatLonInKm(userLat, userLng, client.lat || 0, client.lng || 0);

                                                    if (dist > 0.5) { // 500 meters = 0.5 km
                                                        alert(`⚠️ Estás muy lejos del cliente (${dist.toFixed(2)} km). Debes estar a menos de 500m.`);
                                                    } else {
                                                        navigate(`/visit/${client.id}`);
                                                    }
                                                },
                                                (error) => {
                                                    console.error(error);
                                                    alert("No pudimos obtener tu ubicación. Asegúrate de tener el GPS activado.");
                                                },
                                                { enableHighAccuracy: true }
                                            );
                                        }}
                                        className="flex-1 bg-gray-900 text-white py-4 rounded-2xl text-xs font-bold flex items-center justify-center shadow-lg active:scale-95 transition-all group-hover:bg-indigo-600"
                                    >
                                        Registrar Visita
                                        <ChevronRight size={16} className="ml-2 opacity-50" />
                                    </button>
                                    <button
                                        onClick={() => navigate('/quotations', { state: { client: client } })}
                                        className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-100 transition-colors"
                                        title="Crear Cotización"
                                    >
                                        <FileText size={20} />
                                    </button>
                                </div >
                            </div >
                        );
                    })}
                </div >
            )}

            {/* Client Detail View Modal */}
            {selectedClient && (
                <ClientDetailModal
                    client={selectedClient}
                    onClose={() => setSelectedClient(null)}
                    onEdit={() => {
                        setSelectedClient(null);
                        handleOpenModal(selectedClient);
                    }}
                    onEmail={() => {
                        const clientToEmail = selectedClient;
                        setSelectedClient(null);
                        handleOpenEmailModal(clientToEmail);
                    }}
                />
            )}

            {/* Email Modal */}
            {
                isEmailModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
                            <div className="p-8 md:p-10">
                                <div className="flex justify-between items-center mb-8">
                                    <div>
                                        <h3 className="text-2xl font-black text-gray-900">Redactar Correo</h3>
                                        <p className="text-gray-400 font-bold text-sm">Enviando como {(profile as any)?.full_name}</p>
                                    </div>
                                    <button onClick={() => setIsEmailModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                                        <X size={20} className="text-gray-400" />
                                    </button>
                                </div>

                                <form onSubmit={handleSendGmail} className="space-y-5">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Para</label>
                                        <input
                                            type="email"
                                            disabled
                                            className="w-full p-4 bg-gray-100 text-gray-500 rounded-2xl font-medium outline-none cursor-not-allowed"
                                            value={emailData.to}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">CC / BCC (Opcional)</label>
                                        <input
                                            type="text"
                                            placeholder="correo@ejemplo.com, jefe@dental.cl"
                                            className="w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                            value={emailData.cc}
                                            onChange={e => setEmailData({ ...emailData, cc: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Asunto</label>
                                        <input
                                            required
                                            type="text"
                                            className="w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-900 outline-none"
                                            value={emailData.subject}
                                            onChange={e => setEmailData({ ...emailData, subject: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Mensaje</label>
                                        <textarea
                                            required
                                            rows={8}
                                            className="w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none resize-none"
                                            value={emailData.message}
                                            onChange={e => setEmailData({ ...emailData, message: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between pt-4 gap-4">
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="hidden"
                                            accept=".pdf,.doc,.docx,.jpg,.png"
                                            onChange={handleFileChange}
                                        />
                                        <button
                                            type="button"
                                            className={`flex items-center space-x-2 transition-colors px-4 py-2 rounded-xl border ${attachment ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Paperclip size={18} />
                                            <span className="text-xs font-bold truncate max-w-[150px]">
                                                {attachment ? attachment.name : 'Adjuntar Archivo'}
                                            </span>
                                            {attachment && (
                                                <X
                                                    size={14}
                                                    className="ml-2 cursor-pointer hover:text-red-500"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setAttachment(null);
                                                        if (fileInputRef.current) fileInputRef.current.value = '';
                                                    }}
                                                />
                                            )}
                                        </button>

                                        <button
                                            type="submit"
                                            disabled={sendingEmail}
                                            className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center min-w-[160px]"
                                        >
                                            {sendingEmail ? (
                                                <span className="animate-pulse">Enviando...</span>
                                            ) : (
                                                <>
                                                    <Send size={18} className="mr-2" />
                                                    Enviar Correo
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Create/Edit Client Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
                            <div className="flex flex-col md:flex-row h-full">
                                <div className="hidden md:block w-1/3 bg-gray-100 relative min-h-[400px]">
                                    <Map
                                        defaultCenter={manualLocation || SANTIAGO_CENTER}
                                        defaultZoom={11}
                                        mapId="DEMO_MAP_ID"
                                        className="w-full h-full absolute inset-0"
                                        onClick={(ev) => {
                                            if (ev.detail.latLng) {
                                                setManualLocation({ lat: ev.detail.latLng.lat, lng: ev.detail.latLng.lng });
                                            }
                                        }}
                                    >
                                        {manualLocation && (
                                            <AdvancedMarker position={manualLocation}>
                                                <Pin background={'#4f46e5'} borderColor={'#312e81'} glyphColor={'#fff'} />
                                            </AdvancedMarker>
                                        )}
                                    </Map>
                                    <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur p-4 rounded-2xl shadow-lg border border-white/50">
                                        <p className="text-[10px] font-black uppercase text-indigo-600 mb-1">Geolocalización</p>
                                        <p className="text-xs text-gray-600 font-medium">Pincha en el mapa para ajustar la ubicación exacta.</p>
                                    </div>
                                </div>
                                <div className="flex-1 p-8 md:p-12">
                                    <div className="flex justify-between items-center mb-8">
                                        <div>
                                            <h3 className="text-2xl font-black text-gray-900">{isEditing ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
                                            <p className="text-gray-400 font-bold text-sm">
                                                {isEditing ? 'Actualiza los datos del cliente' : 'Ingresa los datos fiscales y de contacto'}
                                            </p>
                                        </div>
                                        <button onClick={() => setIsModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                                            <Trash2 size={20} className="text-gray-400" />
                                        </button>
                                    </div>
                                    <form onSubmit={handleSaveClient} className="space-y-5">
                                        <div className="grid grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">RUT Empresa <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="text"
                                                    placeholder="76.xxx.xxx-k"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                                    value={clientForm.rut}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setClientForm({ ...clientForm, rut: val })
                                                    }}
                                                    onBlur={() => {
                                                        setClientForm(prev => ({ ...prev, rut: normalizeRut(prev.rut) }))
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Razón Social <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="text"
                                                    placeholder="Nombre de la clínica..."
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                                    value={clientForm.name}
                                                    onChange={e => setClientForm({ ...clientForm, name: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Dirección Comercial <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 z-10" size={18} />
                                                <input
                                                    ref={inputRef}
                                                    required
                                                    type="text"
                                                    placeholder="Comienza a escribir la dirección..."
                                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.address}
                                                    onChange={e => setClientForm({ ...clientForm, address: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Teléfono <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="tel"
                                                    placeholder="+56 9..."
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.phone}
                                                    onChange={e => setClientForm({ ...clientForm, phone: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Email Contacto <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="email"
                                                    placeholder="contacto@clinica.cl"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.email}
                                                    onChange={e => setClientForm({ ...clientForm, email: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Giro <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="text"
                                                    placeholder="Ej: Clínica Dental, Insumos..."
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.giro}
                                                    onChange={e => setClientForm({ ...clientForm, giro: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Comuna</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: San Miguel"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.comuna}
                                                    onChange={e => setClientForm({ ...clientForm, comuna: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Notas Internas <span className="text-gray-300 font-normal lowercase tracking-normal">(opcional)</span></label>
                                            <textarea
                                                rows={3}
                                                placeholder="Horarios, contacto de adquisiciones, preferencias..."
                                                className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none resize-none"
                                                value={clientForm.notes}
                                                onChange={e => setClientForm({ ...clientForm, notes: e.target.value })}
                                            />
                                        </div>
                                        <div className="pt-6 flex gap-4">
                                            <button
                                                type="button"
                                                onClick={() => setIsModalOpen(false)}
                                                className="flex-1 py-4 font-bold text-gray-400 hover:text-gray-600 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={submitting}
                                                className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
                                            >
                                                {submitting ? (
                                                    <span className="animate-pulse">Guardando...</span>
                                                ) : (
                                                    <>
                                                        <CheckCircle2 size={20} className="mr-2" />
                                                        {isEditing ? 'Actualizar Cliente' : 'Registrar Cliente'}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
};

const Clients = () => {
    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <ClientsContent />
        </APIProvider>
    );
};

export default Clients;
