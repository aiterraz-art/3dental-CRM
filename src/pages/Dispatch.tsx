import React, { useState, useEffect } from 'react';
import { read, utils } from 'xlsx';
import { Truck, Upload, AlertCircle, CheckCircle2, Map as MapIcon, Calendar, Printer } from 'lucide-react';
import { supabase } from '../services/supabase';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import DeliveryNoteTemplate from '../components/DeliveryNoteTemplate';
import { useUser } from '../contexts/UserContext';

interface DeliveryRow {
    RUT: string;
    PEDIDO: string | number;
    [key: string]: any;
}

interface MatchedOrder {
    id: string;
    folio: number;
    client_name: string;
    client_address: string;
    client_rut: string;
    lat?: number;
    lng?: number;
    status: string; // current order status
    delivery_status: string;
    route_id?: string | null;
}

interface DeliveryRoute {
    id: string;
    name: string;
    driver_id: string | null;
    status: string;
    created_at: string;
    order_count?: number;
}

interface DriverProfile {
    id: string;
    email: string;
    role: string;
    name?: string; // Optional if not in profile yet
}

const Dispatch: React.FC = () => {
    const [uploading, setUploading] = useState(false);
    const [processedRows, setProcessedRows] = useState<DeliveryRow[]>([]);
    const [matchedOrders, setMatchedOrders] = useState<MatchedOrder[]>([]);
    const [notFound, setNotFound] = useState<DeliveryRow[]>([]);
    const [isMapVisible, setIsMapVisible] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Printing State
    const [printingOrder, setPrintingOrder] = useState<any | null>(null);

    // Route Management State
    const [routes, setRoutes] = useState<DeliveryRoute[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'upload' | 'routes'>('upload');
    const [selectedOrdersForRoute, setSelectedOrdersForRoute] = useState<Set<string>>(new Set());
    const [drivers, setDrivers] = useState<DriverProfile[]>([]);
    const [selectedDriverId, setSelectedDriverId] = useState<string>("");

    // Google Maps Hooks
    const map = useMap("DISPATCH_MAP");
    const routesLibrary = useMapsLibrary('routes');
    const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);
    const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer | null>(null);

    useEffect(() => {
        if (!routesLibrary || !map) return;
        setDirectionsService(new routesLibrary.DirectionsService());
        setDirectionsRenderer(new routesLibrary.DirectionsRenderer({ map, suppressMarkers: true }));
    }, [routesLibrary, map]);

    useEffect(() => {
        fetchRoutes();
        fetchDrivers();
    }, []);

    const fetchDrivers = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('role', 'driver');

        if (!error && data) {
            setDrivers(data as DriverProfile[]);
        }
    };

    const fetchRoutes = async () => {
        const { data, error } = await supabase
            .from('delivery_routes')
            .select(`
                *,
                driver:profiles(email, role)
            `)
            .order('created_at', { ascending: false });

        if (!error && data) {
            // Get order counts from route_items
            const routesWithCounts = await Promise.all(data.map(async (route) => {
                const { count } = await supabase.from('route_items').select('*', { count: 'exact', head: true }).eq('route_id', route.id);
                return { ...route, order_count: count || 0 };
            }));
            setRoutes(routesWithCounts);
        }
    };

    const handlePrintGuide = async (orderId: string) => {
        // Fetch full order details including items
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                client:clients(*),
                order_items(*)
            `)
            .eq('id', orderId)
            .single();

        if (error || !data) {
            console.error("Error loading order for print:", error);
            alert("No se pudo cargar la información del pedido.");
            return;
        }

        // Format data for template
        const deliveryData = {
            folio: data.folio || parseInt(data.id.slice(0, 4), 16), // Fallback to pseudo-folio from ID if missing
            date: new Date(data.created_at).toLocaleDateString(),
            clientName: data.client.name,
            clientRut: data.client.rut,
            clientAddress: data.client.address || data.client.zone,
            clientPhone: data.client.phone,
            driverName: "Juan Mena", // Could be dynamic if we assign drivers
            items: data.order_items.map((item: any) => ({
                code: item.product_id ? 'PROD' : 'GEN',
                detail: item.product_name,
                qty: item.quantity,
                unit: 'unid'
            }))
        };

        setPrintingOrder(deliveryData);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setProcessedRows([]);
        setMatchedOrders([]);
        setNotFound([]);

        try {
            const data = await file.arrayBuffer();
            const workbook = read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData: DeliveryRow[] = utils.sheet_to_json(worksheet);

            console.log("Uploaded Data:", jsonData);
            setProcessedRows(jsonData);
            await matchOrders(jsonData);

        } catch (error) {
            console.error("Error parsing Excel:", error);
            alert("Error al leer el archivo Excel. Asegúrate de que tenga columnas 'RUT' y 'PEDIDO'.");
        } finally {
            setUploading(false);
        }
    };

    const matchOrders = async (rows: DeliveryRow[]) => {
        const found: MatchedOrder[] = [];
        const missing: DeliveryRow[] = [];

        const { data: allOrders, error } = await supabase
            .from('orders')
            .select(`
                id, status, delivery_status,
                client:clients(name, address, zone, rut),
                seller_location:seller_locations(lat, lng) 
            `)
            .not('status', 'eq', 'rejected'); // Filter out rejected

        if (error || !allOrders) {
            console.error("Error fetching orders:", error);
            return;
        }

        // Create a map for fast lookup
        const orderMap = new Map();
        allOrders.forEach((o: any) => {
            if (o.client?.rut) {
                const rutClean = o.client.rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
                // Use a fallback for key generation if folio is missing
                const key = `${o.folio || 0}-${rutClean}`;
                orderMap.set(key, o);
            }
        });

        rows.forEach(row => {
            const rowRut = String(row.RUT || '').replace(/\./g, '').replace(/-/g, '').toUpperCase();
            const rowFolio = String(row.PEDIDO || '').trim();
            const key = `${rowFolio}-${rowRut}`;

            const match = orderMap.get(key);

            if (match) {
                const loc = match.seller_location && match.seller_location.length > 0 ? match.seller_location[0] : null;

                found.push({
                    id: match.id,
                    folio: match.folio,
                    client_name: match.client.name,
                    client_address: match.client.address || match.client.zone,
                    client_rut: match.client.rut,
                    lat: loc?.lat,
                    lng: loc?.lng,
                    status: match.status,
                    delivery_status: match.delivery_status || 'pending'
                });
            } else {
                missing.push(row);
            }
        });

        setMatchedOrders(found);
        setNotFound(missing);
    };

    const handleGenerateRoute = () => {
        if (!directionsService || !directionsRenderer || matchedOrders.length === 0) return;

        const officeLocation = { lat: -33.3768, lng: -70.6725 }; // Americo Vespucio 2880, Conchali

        const waypoints = matchedOrders
            .filter(o => o.lat && o.lng)
            .map(o => ({
                location: { lat: Number(o.lat), lng: Number(o.lng) },
                stopover: true
            }));

        directionsService.route({
            origin: officeLocation,
            destination: officeLocation,
            waypoints: waypoints,
            optimizeWaypoints: true,
            travelMode: google.maps.TravelMode.DRIVING
        }, (result, status) => {
            if (status === 'OK' && result) {
                directionsRenderer.setDirections(result);

                // Reorder matchedOrders based on optimization result
                if (result.routes[0] && result.routes[0].waypoint_order) {
                    const optimizedOrder = result.routes[0].waypoint_order;
                    const newOrders = optimizedOrder.map(index => matchedOrders[index]);
                    setMatchedOrders(newOrders);
                }
            } else {
                console.error("Directions request failed due to " + status);
                alert("No se pudo generar la ruta: " + status);
            }
        });
    };

    // Route Management Functions
    const toggleOrderSelection = (orderId: string) => {
        const newSet = new Set(selectedOrdersForRoute);
        if (newSet.has(orderId)) {
            newSet.delete(orderId);
        } else {
            newSet.add(orderId);
        }
        setSelectedOrdersForRoute(newSet);
    };

    const handleSelectAll = (selectAll: boolean) => {
        if (selectAll) {
            const allIds = matchedOrders.map(o => o.id);
            setSelectedOrdersForRoute(new Set(allIds));
        } else {
            setSelectedOrdersForRoute(new Set());
        }
    };

    const handleCreateRoute = async () => {
        // Validate items selected
        if (selectedOrdersForRoute.size === 0) {
            alert("Selecciona al menos un pedido para crear una ruta.");
            return;
        }

        // Validate Driver (MANDATORY REQUEST)
        if (!selectedDriverId) {
            alert("⚠️ Debes asignar un conductor obligatoriamente antes de iniciar la ruta.");
            return;
        }

        // Prompt for route name
        const routeName = prompt("Nombre de la Ruta (ej. Ruta Centro - 20/01):", `Ruta ${new Date().toLocaleDateString()}`);
        if (!routeName) return;

        setSubmitting(true);
        try {
            // 1. Create Route Header
            const { data: routeData, error: routeError } = await supabase
                .from('delivery_routes')
                .insert({
                    name: routeName,
                    driver_id: selectedDriverId || null,
                    status: 'active',
                })
                .select()
                .single();

            if (routeError) throw routeError;

            // 2. Prepare Route Items
            const itemsToInsert = Array.from(selectedOrdersForRoute).map((orderId, index) => ({
                route_id: routeData.id,
                order_id: orderId,
                sequence_order: index + 1,
                status: 'pending'
            }));

            // 3. Insert Route Items
            const { error: itemsError } = await supabase
                .from('route_items')
                .insert(itemsToInsert);

            if (itemsError) throw itemsError;

            // 4. Update Orders Status & Pointer (Dual-write for compatibility)
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    route_id: routeData.id,
                    delivery_status: 'out_for_delivery' // Mark as out immediately or keep pending? Let's say out for delivery for now or keep 'pending' until dispatched. 
                    // Actually, keeping 'pending' allows the "Start Dispatch" button to do the transition.
                    // But typically creating the route implies it's being prepared.
                    // Let's set it to 'out_for_delivery' to simplify workflow for v1.
                })
                .in('id', Array.from(selectedOrdersForRoute));

            if (updateError) throw updateError;

            alert("¡Ruta creada exitosamente!");
            setSelectedOrdersForRoute(new Set());
            fetchRoutes();
            setActiveTab('routes');

        } catch (error: any) {
            console.error("Error creating route:", error);
            alert("Error al crear ruta: " + error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleSimulateData = async () => {
        if (!confirm("¿Generar 10 pedidos de prueba en Santiago? Esto creará clientes y ordenes ficticias.")) return;
        setSubmitting(true);
        try {
            // Validate User Directly from Supabase (More robust than context for this action)
            const { data: { user }, error: authError } = await supabase.auth.getUser();

            if (authError || !user) {
                console.error("Auth Error:", authError);
                alert("Error: No se detectó un usuario activo (Sesión expirada o inválida). Por favor recarga la página o inicia sesión nuevamente.");
                return;
            }

            const mockClients = [
                { name: 'Clínica Dental Santiago Centro', rut: '76.111.111-1', address: 'Alameda 1234', comuna: 'Santiago', phone: '+56911111111', lat: -33.4430, lng: -70.6530 },
                { name: 'Odontología Providencia', rut: '76.222.222-2', address: 'Av. Providencia 2000', comuna: 'Providencia', phone: '+56922222222', lat: -33.4260, lng: -70.6120 },
                { name: 'Centro Médico Las Condes', rut: '76.333.333-3', address: 'Av. Apoquindo 4000', comuna: 'Las Condes', phone: '+56933333333', lat: -33.4140, lng: -70.5850 },
                { name: 'Dental Vitacura', rut: '76.444.444-4', address: 'Av. Vitacura 5000', comuna: 'Vitacura', phone: '+56944444444', lat: -33.3980, lng: -70.5700 },
                { name: 'Ortodoncia Ñuñoa', rut: '76.555.555-5', address: 'Irarrázaval 3000', comuna: 'Ñuñoa', phone: '+56955555555', lat: -33.4550, lng: -70.6000 },
                { name: 'Sonrisas La Reina', rut: '76.666.666-6', address: 'Av. Ossa 1000', comuna: 'La Reina', phone: '+56966666666', lat: -33.4400, lng: -70.5600 },
                { name: 'Implantes Recoleta', rut: '76.777.777-7', address: 'Av. Recoleta 2500', comuna: 'Recoleta', phone: '+56977777777', lat: -33.4000, lng: -70.6400 },
                { name: 'Frenillos Independencia', rut: '76.888.888-8', address: 'Independencia 1500', comuna: 'Independencia', phone: '+56988888888', lat: -33.4100, lng: -70.6550 },
                { name: 'Estética Huechuraba', rut: '76.999.999-9', address: 'Pedro Fontova 7000', comuna: 'Huechuraba', phone: '+56999999999', lat: -33.3600, lng: -70.6600 },
                { name: 'Salud Oral Quilicura', rut: '76.000.000-0', address: 'O Higgins 400', comuna: 'Quilicura', phone: '+56900000000', lat: -33.3600, lng: -70.7300 }
            ];

            // 1. Upsert Clients
            const { data: insertedClients, error: clientsError } = await supabase
                .from('clients')
                .upsert(mockClients, { onConflict: 'rut' })
                .select('id, rut');

            if (clientsError) throw new Error("Error creando clientes: " + clientsError.message);
            if (!insertedClients) throw new Error("Upsert de clientes no retornó datos.");

            // 2. Create Orders
            const ordersToInsert = insertedClients.map(client => ({
                client_id: client.id,
                user_id: user.id,
                status: 'approved',
                total_amount: Math.floor(Math.random() * 500000) + 50000,
                // folio: Removed as column doesn't exist in orders
                delivery_status: 'pending',
                created_at: new Date().toISOString()
            }));

            const { data: insertedOrders, error: ordersError } = await supabase
                .from('orders')
                .insert(ordersToInsert)
                .select(); // Select to get IDs back

            if (ordersError) throw new Error("Error creando órdenes: " + ordersError.message);
            if (!insertedOrders) throw new Error("Insert de órdenes no retornó datos.");

            // 3. Update State
            const newlyMatched: MatchedOrder[] = insertedOrders.map((order: any, index: number) => ({
                id: order.id,
                folio: 0, // Mock holder
                client_name: mockClients[index].name,
                client_address: mockClients[index].address,
                client_rut: mockClients[index].rut,
                lat: mockClients[index].lat,
                lng: mockClients[index].lng,
                status: order.status,
                delivery_status: order.delivery_status
            }));

            console.log("Matched Orders:", newlyMatched);
            setMatchedOrders(newlyMatched);
            setProcessedRows(newlyMatched.map(o => ({ RUT: o.client_rut, PEDIDO: 'SIMULADO' })));

            alert(`✅ ¡Éxito! Se han generado ${newlyMatched.length} pedidos de prueba.`);
        } catch (err: any) {
            console.error("Error simulation:", err);
            alert("❌ Error: " + err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleStartDispatch = async () => {
        if (matchedOrders.length === 0) return;
        if (!confirm(`¿Iniciar despacho para ${matchedOrders.length} pedidos? Cambiarán a estado "En Ruta".`)) return;

        setSubmitting(true);
        try {
            const ids = matchedOrders.map(o => o.id);
            const { error } = await supabase
                .from('orders')
                .update({
                    delivery_status: 'out_for_delivery',
                    updated_at: new Date().toISOString()
                })
                .in('id', ids);

            if (error) throw error;

            alert("¡Despacho iniciado exitosamente!");
            setMatchedOrders(prev => prev.map(o => ({ ...o, delivery_status: 'out_for_delivery' })));

        } catch (err: any) {
            console.error("Error updating orders:", err);
            alert("Error al actualizar pedidos: " + err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between gap-6 items-start">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight">Centro de Despacho</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">Carga masiva y planificación de rutas</p>
                    <button
                        onClick={handleSimulateData}
                        className="mt-2 text-xs font-bold text-indigo-500 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors"
                    >
                        ⚙️ Simular 10 Pedidos (Demo)
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-4 mb-4">
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`px-4 py-2 rounded-lg font-bold transition-all ${activeTab === 'upload' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                    >
                        Planificación (Excel)
                    </button>
                    <button
                        onClick={() => setActiveTab('routes')}
                        className={`px-4 py-2 rounded-lg font-bold transition-all ${activeTab === 'routes' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                    >
                        Historial de Rutas
                    </button>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={handleGenerateRoute}
                        className="px-6 py-4 rounded-2xl font-bold flex items-center transition-all bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-200 shadow-sm"
                    >
                        <MapIcon className="mr-2" size={20} />
                        Optimizar Ruta
                    </button>
                    <button
                        onClick={() => setIsMapVisible(!isMapVisible)}
                        className={`px-6 py-4 rounded-2xl font-bold flex items-center transition-all ${isMapVisible ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                        <MapIcon className="mr-2" size={20} />
                        {isMapVisible ? 'Ocultar Mapa' : 'Ver en Mapa'}
                    </button>

                    <div className="relative">
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            disabled={uploading || submitting}
                        />
                        <button className="bg-emerald-500 text-white px-8 py-4 rounded-2xl font-bold flex items-center shadow-xl shadow-emerald-100 hover:bg-emerald-600 transition-all active:scale-95">
                            <Upload size={20} className="mr-3" />
                            {uploading ? 'Procesando...' : 'Cargar Excel'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats / Overview */}
            {processedRows.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-gray-400 tracking-widest">Leídos</p>
                            <p className="text-3xl font-black text-gray-900">{processedRows.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400">
                            <Upload size={24} />
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-green-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-green-400 tracking-widest">Encontrados</p>
                            <p className="text-3xl font-black text-green-600">{matchedOrders.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-500">
                            <CheckCircle2 size={24} />
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-red-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-red-400 tracking-widest">No Encontrados</p>
                            <p className="text-3xl font-black text-red-600">{notFound.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
                            <AlertCircle size={24} />
                        </div>
                    </div>
                </div>
            )}

            {/* Action Bar */}
            {matchedOrders.length > 0 && (
                <div className="bg-white p-6 rounded-3xl shadow-xl border border-indigo-100 flex flex-col md:flex-row justify-between items-center gap-4 sticky bottom-6 z-40">

                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={matchedOrders.length > 0 && selectedOrdersForRoute.size === matchedOrders.length}
                                onChange={(e) => handleSelectAll(e.target.checked)}
                                className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span className="font-bold text-gray-700">Seleccionar Todos ({matchedOrders.length})</span>
                        </div>
                        <span className="text-gray-300">|</span>
                        <span className="font-bold text-indigo-600">{selectedOrdersForRoute.size} Seleccionados</span>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="relative flex-1 md:flex-none">
                            <select
                                value={selectedDriverId}
                                onChange={(e) => setSelectedDriverId(e.target.value)}
                                className={`w-full md:w-64 pl-4 pr-10 py-3 rounded-xl appearance-none font-bold outline-none ring-2 transition-all cursor-pointer ${!selectedDriverId ? 'ring-red-200 bg-red-50 text-red-500 animate-pulse' : 'ring-gray-100 bg-gray-50 text-gray-800'
                                    }`}
                            >
                                <option value="">-- Asignar Conductor (Requerido) --</option>
                                {drivers.length > 0 ? (
                                    drivers.map(d => (
                                        <option key={d.id} value={d.id}>
                                            {d.name || d.email} ({d.role})
                                        </option>
                                    ))
                                ) : (
                                    <option disabled>No hay conductores disponibles</option>
                                )}
                            </select>
                            <div className="absolute right-3 top-3.5 pointer-events-none text-gray-400">
                                <Truck size={16} />
                            </div>
                        </div>

                        <button
                            onClick={handleCreateRoute}
                            disabled={submitting || selectedOrdersForRoute.size === 0}
                            className={`px-8 py-3 rounded-xl font-black text-lg shadow-lg flex items-center transition-all active:scale-95 ${submitting || selectedOrdersForRoute.size === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' :
                                    !selectedDriverId ? 'bg-gray-800 text-gray-500 cursor-not-allowed' :
                                        'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                                }`}
                            title={!selectedDriverId ? "Selecciona un conductor primero" : ""}
                        >
                            <MapIcon className="mr-2" size={20} />
                            {submitting ? 'Procesando...' : 'Crear & Iniciar Ruta'}
                        </button>
                    </div>
                </div>
            )}

            {/* Layout: Map vs List */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* List Column */}
                <div className={`${isMapVisible ? 'lg:col-span-1' : 'lg:col-span-3'} space-y-6`}>

                    {matchedOrders.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-black text-gray-900">Pedidos Listos para Ruta</h3>
                            {matchedOrders.map(order => (
                                <div key={order.id} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md text-[10px] font-black uppercase tracking-wider">
                                                    Folio {order.folio || order.id.slice(0, 8)}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${order.delivery_status === 'out_for_delivery' ? 'bg-amber-100 text-amber-700' :
                                                    order.delivery_status === 'delivered' ? 'bg-green-100 text-green-700' :
                                                        'bg-gray-100 text-gray-500'
                                                    }`}>
                                                    {order.delivery_status === 'out_for_delivery' ? 'En Ruta' :
                                                        order.delivery_status === 'delivered' ? 'Entregado' : 'Pendiente'}
                                                </span>
                                            </div>
                                            <h4 className="font-bold text-gray-900 leading-tight">
                                                {order.client_name}
                                                {/* Debug Info */}
                                                {/* <span className="text-xs text-gray-300 ml-2">({order.lat}, {order.lng})</span> */}
                                            </h4>
                                            <p className="text-xs text-gray-400 font-medium mt-1 truncate max-w-[250px]">{order.client_address}</p>

                                            <button
                                                onClick={() => handlePrintGuide(order.id)}
                                                className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-indigo-600 transition-colors"
                                            >
                                                <Printer size={12} />
                                                Imprimir Guía
                                            </button>
                                            <div className="mt-2 flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedOrdersForRoute.has(order.id)}
                                                    onChange={() => toggleOrderSelection(order.id)}
                                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className="text-xs font-medium text-gray-600">Seleccionar para Ruta</span>
                                            </div>
                                        </div>
                                        {order.lat && order.lng ? (
                                            <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                                                <MapIcon size={14} />
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-500" title="Sin georreferencia">
                                                <AlertCircle size={14} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {notFound.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-black text-red-500">Errores de Coincidencia ({notFound.length})</h3>
                            <div className="bg-red-50 rounded-3xl p-6 border border-red-100">
                                <ul className="space-y-3">
                                    {notFound.map((row, idx) => (
                                        <li key={idx} className="flex items-center justify-between text-xs font-bold text-red-800 border-b border-red-100 last:border-0 pb-2 last:pb-0">
                                            <span>RUT: {row.RUT}</span>
                                            <span>Pedido: {row.PEDIDO}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-4 text-[10px] text-red-400 uppercase font-black tracking-widest text-center">
                                    Verifica que el RUT y el N° de Pedido coincidan exactamente.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {activeTab === 'routes' && (
                    <div className="col-span-full">
                        <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-xl">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-2xl font-black text-gray-900">Historial de Rutas</h3>
                                <button onClick={fetchRoutes} className="text-sm font-bold text-indigo-600 hover:underline">Actualizar</button>
                            </div>

                            {routes.length === 0 ? (
                                <p className="text-center text-gray-400 py-10">No hay rutas creadas.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {routes.map(route => (
                                        <div key={route.id} className="bg-gray-50 p-6 rounded-3xl border border-gray-200">
                                            <div className="flex justify-between items-start mb-4">
                                                <div>
                                                    <h4 className="font-bold text-lg text-gray-900">{route.name}</h4>
                                                    <p className="text-xs text-indigo-600 font-bold mb-1">
                                                        {(route as any).driver?.email ? `🚛 ${(route as any).driver.email}` : '⚠️ Sin Conductor'}
                                                    </p>
                                                    <p className="text-xs text-gray-500 font-medium">{new Date(route.created_at).toLocaleDateString()} • {new Date(route.created_at).toLocaleTimeString()}</p>
                                                </div>
                                                <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${route.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                                    }`}>
                                                    {route.status === 'completed' ? 'Completada' : 'Activa'}
                                                </span>
                                            </div>
                                            <p className="text-sm font-bold text-gray-600 mb-4">{route.order_count} Pedidos</p>
                                            {/* Future: Add "View Details" or "Delete" */}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}


                {/* Map Column */}
                {isMapVisible && (
                    <div className="lg:col-span-2 h-[600px] bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden sticky top-6">
                        <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
                            <GoogleMap
                                defaultCenter={{ lat: -33.4489, lng: -70.6693 }} // Santiago
                                defaultZoom={11}
                                mapId="DISPATCH_MAP"
                                className="w-full h-full"
                            >
                                {matchedOrders.filter(o => o.lat && o.lng).map((order, idx) => (
                                    <AdvancedMarker key={order.id} position={{ lat: Number(order.lat), lng: Number(order.lng) }}>
                                        <Pin background={order.delivery_status === 'out_for_delivery' ? '#F59E0B' : '#4F46E5'} borderColor={'white'} glyphColor={'white'} scale={1.2}>
                                            <span className="text-[10px] font-bold text-white pt-1">{idx + 1}</span>
                                        </Pin>
                                    </AdvancedMarker>
                                ))}
                                <AdvancedMarker position={{ lat: -33.3768, lng: -70.6725 }}>
                                    <div className="bg-slate-900 text-white p-2 rounded-lg text-xs font-bold shadow-xl border-2 border-white flex items-center gap-1 z-50">
                                        <span className="text-lg">🏢</span>
                                        <span>Central</span>
                                    </div>
                                </AdvancedMarker>
                            </GoogleMap>
                        </APIProvider>
                        <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-lg border border-gray-100">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Ruta Sugerida</p>
                                    <p className="font-bold text-indigo-600">Optimizada por Google Maps</p>
                                </div>
                                {/* Future: Add "Navigate" or "Send to Driver" button */}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Print Modal */}
            {printingOrder && (
                <DeliveryNoteTemplate
                    data={printingOrder}
                    onClose={() => setPrintingOrder(null)}
                />
            )}
        </div>
    );
};

export default Dispatch;
