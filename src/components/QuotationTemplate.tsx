import React from 'react';
import { Printer, Download, X, Share2, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface QuotationItem {
    code: string;
    detail: string;
    subDetail?: string;
    qty: number;
    unit: string;
    price: number;
    discount: number;
    total: number;
}

interface QuotationData {
    folio: number;
    date: string;
    expiryDate: string;
    clientName: string;
    clientRut: string;
    clientAddress: string;
    clientCity: string;
    clientComuna: string;
    clientGiro: string;
    clientPhone?: string;
    clientEmail?: string;
    clientContact?: string;
    paymentTerms: string;
    sellerName: string;
    items: QuotationItem[];
    comments?: string;
}

interface Props {
    data: QuotationData;
    onClose: () => void;
}

const QuotationTemplate: React.FC<Props> = ({ data, onClose }) => {
    const contentRef = React.useRef<HTMLDivElement>(null);
    const [generatingPdf, setGeneratingPdf] = React.useState(false);

    // Robust parsing: items could be a string (JSON) or an object
    let items: QuotationItem[] = [];
    try {
        if (typeof data.items === 'string') {
            items = JSON.parse(data.items);
        } else if (Array.isArray(data.items)) {
            items = data.items;
        }
    } catch (e) {
        console.error("Error parsing items:", e);
        items = [];
    }

    // Calculate from scratch to be safe
    const subtotal = items.reduce((acc, item) => acc + (item.total || 0), 0);
    const tax = Math.round(subtotal * 0.19);
    const total = subtotal + tax;

    // Simple number to words (very basic version for demo, could be a library like numero-a-letras)
    const numberToWords = (num: number) => {
        // This is a placeholder for a real implementation
        return "MONTO TOTAL EN PESOS";
    };

    const generatePdfBlob = async (): Promise<Blob | null> => {
        if (!contentRef.current) return null;

        try {
            const width = 1000; // Standard desktop width for the capture

            const canvas = await html2canvas(contentRef.current, {
                scale: 2.5,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                windowWidth: width,
                width: width,
                onclone: (clonedDoc) => {
                    const container = clonedDoc.querySelector('[ref-content-container]');
                    if (container instanceof HTMLElement) {
                        // FORCE ABSOLUTE STYLES FOR CAPTURE
                        container.style.width = '1000px';
                        container.style.padding = '50px';
                        container.style.margin = '0 auto';
                        container.style.boxSizing = 'border-box';
                    }

                    const style = clonedDoc.createElement('style');
                    style.innerHTML = `
                        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
                        * { 
                            -webkit-print-color-adjust: exact !important; 
                            font-family: 'Inter', sans-serif !important;
                        }
                        .grid { display: grid !important; grid-template-columns: repeat(12, 1fr) !important; gap: 0.5rem !important; }
                        .flex { display: flex !important; flex-direction: row !important; }
                        .flex-col { flex-direction: column !important; } /* Restore internal column logic if needed */
                        .col-span-12 { grid-column: span 12 / span 12 !important; }
                        .col-span-8 { grid-column: span 8 / span 8 !important; }
                        .col-span-4 { grid-column: span 4 / span 4 !important; }
                        .col-span-3 { grid-column: span 3 / span 3 !important; }
                        .col-span-2 { grid-column: span 2 / span 2 !important; }
                        .hidden { display: block !important; }
                        .md\\:block { display: block !important; }
                        .md\\:flex-row { flex-direction: row !important; }
                        
                        /* Force font sizes to absolute px to avoid viewport scaling */
                        .text-[11px] { font-size: 11px !important; }
                        .text-[9px] { font-size: 9px !important; }
                        .text-[8px] { font-size: 8px !important; }
                        .text-xs { font-size: 12px !important; }
                        .text-sm { font-size: 14px !important; }
                        .text-lg { font-size: 18px !important; }
                    `;
                    clonedDoc.head.appendChild(style);
                }
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.9);
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
                compress: true
            });

            const imgWidth = 210;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
            return pdf.output('blob');
        } catch (error) {
            console.error("Error generating PDF Blob:", error);
            return null;
        }
    };

    const handleShare = async () => {
        const shareText = `Estimado(a) ${data.clientName},\n\nLe adjunto la cotización Folio Nº ${data.folio} de 3Dental.\n\nTotal: $${total.toLocaleString()}\nVendedor: ${data.sellerName}\n\nGracias por su confianza.`;
        const fileName = `Cotizacion_3Dental_${data.folio}.pdf`;

        setGeneratingPdf(true);
        try {
            const pdfBlob = await generatePdfBlob();

            if (!pdfBlob) {
                alert("Error generando archivo.");
                return;
            }

            const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

            // CLEAN SHARE: No URL field, just text and file
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: `Cotización ${data.folio}`,
                    text: shareText
                });
            } else {
                // FALLBACK ONLY: Just text message (NO LINK)
                const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
                window.open(waUrl, '_blank');
            }
        } catch (err) {
            console.error('Share error:', err);
            // Don't alert "AbortError" as it's usually just user canceling the share dialog
            if (err instanceof Error && err.name !== 'AbortError') {
                alert("Hubo un error al intentar compartir.");
            }
        } finally {
            setGeneratingPdf(false);
        }
    };

    const handleDownloadPDF = async () => {
        setGeneratingPdf(true);
        try {
            const pdfBlob = await generatePdfBlob();
            if (pdfBlob) {
                const url = URL.createObjectURL(pdfBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `Cotizacion_3Dental_${data.folio}.pdf`;
                link.click();
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error("Download error:", error);
        } finally {
            setGeneratingPdf(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-0 md:p-8 overflow-y-auto"
            onClick={onClose}
        >
            <div
                className="bg-white w-full max-w-5xl shadow-2xl flex flex-col h-full md:h-auto md:max-h-[95vh] animate-in fade-in duration-300 md:rounded-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                style={{ cursor: 'default' }}
            >
                {/* Actions Header (Not part of print) */}
                <div className="bg-gray-100 p-4 border-b flex justify-between items-center print:hidden shrink-0">
                    <h3 className="font-bold text-gray-700 hidden md:block">Visualización de Cotización</h3>

                    <div className="flex items-center space-x-2 md:space-x-4 w-full md:w-auto justify-between md:justify-end">
                        <button
                            onClick={handleShare}
                            disabled={generatingPdf}
                            className="flex-1 md:flex-none flex items-center justify-center px-4 py-3 md:py-2 bg-green-500 text-white rounded-lg text-sm font-bold active:scale-95 transition-all disabled:opacity-50"
                        >
                            {generatingPdf ? <Loader2 size={16} className="animate-spin mr-2" /> : <Share2 size={16} className="mr-2" />} Compartir
                        </button>
                        <button
                            onClick={handleDownloadPDF}
                            disabled={generatingPdf}
                            className="flex-1 md:flex-none flex items-center justify-center px-4 py-3 md:py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold active:scale-95 transition-all disabled:opacity-50"
                        >
                            {generatingPdf ? <Loader2 size={16} className="animate-spin mr-2" /> : <Download size={16} className="mr-2" />} PDF
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-all text-gray-400">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Print Content Container with Horizontal Scroll on Mobile */}
                <div
                    className="flex-1 overflow-auto bg-gray-50 flex justify-center p-0 md:p-10"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                >
                    <div
                        ref={contentRef}
                        // @ts-ignore
                        ref-content-container="true"
                        className="bg-white p-12 shadow-sm min-w-[950px] md:min-w-0 md:w-full max-w-[1000px] text-[11px] font-sans leading-relaxed text-gray-800 print:p-0 print:shadow-none print:min-w-0"
                    >

                        {/* Header Section */}
                        <div className="flex justify-between items-start mb-10">
                            <div className="space-y-1">
                                <div className="flex items-center space-x-2 mb-4">
                                    <img src="/logo_3dental.png" alt="3dental" className="h-16 w-auto" />
                                </div>
                                <p className="font-bold text-xs uppercase">3DENTAL SPA</p>
                                <p>Venta insumos dentales</p>
                                <p>Avenida Americo Vespucio 2880 of 1403, CONCHALI</p>
                                <p>Teléfono: 961183899</p>
                                <p>Email: <span className="text-blue-600 underline">aterraza@3dental.cl</span></p>
                            </div>

                            <div className="w-64 border-2 border-orange-400 p-4 text-center rounded-lg space-y-2">
                                <p className="text-orange-500 font-extrabold text-sm tracking-widest">R.U.T: 76.921.029-6</p>
                                <p className="text-orange-500 font-black text-lg uppercase tracking-wider">Cotización</p>
                                <p className="text-orange-500 font-extrabold text-sm uppercase">Folio N° {data.folio}</p>
                            </div>
                        </div>

                        {/* Client Info Grid */}
                        <div className="grid grid-cols-12 gap-y-3 mb-8 border-t border-b border-gray-100 py-6">
                            <div className="col-span-4 self-start">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Señor (es)</p>
                                <p className="font-bold uppercase text-[12px]">{data.clientName}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Ciudad</p>
                                <p className="font-bold uppercase">{data.clientCity}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Giro</p>
                                <p className="font-bold uppercase truncate pr-4" title={data.clientGiro}>{data.clientGiro}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">R.U.T</p>
                                <p className="font-bold uppercase">{data.clientRut}</p>
                            </div>

                            <div className="col-span-4">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Dirección</p>
                                <p className="font-bold uppercase">{data.clientAddress}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Condición de pago</p>
                                <p className="font-bold uppercase">
                                    {(() => {
                                        try {
                                            const parsed = typeof data.paymentTerms === 'string' ? JSON.parse(data.paymentTerms) : data.paymentTerms;
                                            if (typeof parsed === 'object' && parsed !== null) {
                                                return `${parsed.type}${parsed.days > 0 ? ` - ${parsed.days} DÍAS` : ''}`;
                                            }
                                            return data.paymentTerms;
                                        } catch {
                                            return data.paymentTerms;
                                        }
                                    })()}
                                </p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Vendedor</p>
                                <p className="font-bold uppercase">{data.sellerName}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Tipo de Cambio</p>
                                <p className="font-bold uppercase">PESO</p>
                            </div>

                            <div className="col-span-4">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Comuna</p>
                                <p className="font-bold uppercase">{data.clientComuna}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Emisión</p>
                                <p className="font-bold uppercase">{data.date}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Vencimiento</p>
                                <p className="font-bold uppercase">{data.expiryDate}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Tasa de Cambio</p>
                                <p className="font-bold uppercase">1</p>
                            </div>

                            {/* New Contact Info Row */}
                            {(data.clientContact || data.clientPhone || data.clientEmail) && (
                                <div className="col-span-12 grid grid-cols-12 mt-2 pt-3 border-t border-gray-50 bg-gray-50/20 rounded-lg">
                                    <div className="col-span-4 pl-2">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Atención Dr/Clínica</p>
                                        <p className="font-bold uppercase text-[10px] text-indigo-600">{data.clientContact || '---'}</p>
                                    </div>
                                    <div className="col-span-4">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Teléfono Contacto</p>
                                        <p className="font-bold uppercase text-[10px]">{data.clientPhone || '---'}</p>
                                    </div>
                                    <div className="col-span-4">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Email Contacto</p>
                                        <p className="font-bold uppercase text-[10px] lowercase text-blue-500">{data.clientEmail || '---'}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Items Table */}
                        <div className="min-h-[400px]">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b-2 border-gray-100 text-sm font-bold text-gray-500">
                                        <th className="py-4 text-left pl-4">Ítem</th>
                                        <th className="p-2 font-medium w-24">Código</th>
                                        <th className="p-2 font-medium">Detalle</th>
                                        <th className="p-2 font-medium w-16 text-center">Cant</th>
                                        <th className="p-2 font-medium w-24 text-right">P. Unitario</th>
                                        <th className="p-2 font-medium w-20 text-right">Rec/Desc</th>
                                        <th className="p-2 font-medium w-24 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, index) => (
                                        <React.Fragment key={index}>
                                            <tr className="border-b border-gray-50 align-top">
                                                <td className="p-2 text-center text-gray-400">{index + 1}</td>
                                                <td className="p-2 font-medium">{item.code}</td>
                                                <td className="p-2 font-black uppercase tracking-tight">{item.detail}</td>
                                                <td className="p-2 text-center uppercase">{item.qty} {item.unit}</td>
                                                <td className="p-2 text-right">${item.price.toLocaleString()}</td>
                                                <td className="p-2 text-right border-l border-gray-50 text-gray-400">${item.discount}</td>
                                                <td className="p-2 text-right font-bold border-l border-gray-50">${item.total.toLocaleString()}</td>
                                            </tr>
                                            {item.subDetail && (
                                                <tr className="border-b border-gray-50">
                                                    <td colSpan={2}></td>
                                                    <td className="p-2 pt-0 pb-4 text-[9px] text-gray-400 italic font-medium leading-none">
                                                        Desc. Detallada: {item.subDetail}
                                                    </td>
                                                    <td colSpan={4}></td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer / Totals Section */}
                        <div className="grid grid-cols-12 mt-8 gap-8 items-start">
                            <div className="col-span-8 border border-gray-100 rounded-lg p-6 min-h-[100px]">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-4">Comentario</p>
                                <p className="text-gray-600 font-medium italic">{data.comments || "Sin comentarios adicionales."}</p>
                            </div>

                            <div className="col-span-4 space-y-2">
                                <div className="flex justify-between items-center text-gray-500">
                                    <span className="font-bold">Recargo/Dscto.</span>
                                    <span>$ 0</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-800 font-bold">
                                    <span>Afecto</span>
                                    <span>$ {subtotal.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-500">
                                    <span>Exento</span>
                                    <span>$ 0</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-800 font-bold">
                                    <span>19% IVA</span>
                                    <span>$ {tax.toLocaleString()}</span>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-between items-end">
                                    <div>
                                        <p className="font-bold text-lg text-orange-400 tracking-tighter">Total</p>
                                        <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mt-1">{numberToWords(total)}</p>
                                    </div>
                                    <p className="text-2xl font-black text-orange-400 tracking-tighter leading-none">$ {total.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>

                        {/* Logo Bottom (Small) */}
                        <div className="mt-auto pt-12 flex justify-center opacity-10 grayscale">
                            <div className="text-xl font-black text-gray-400 tracking-tighter italic">3Dental<span className="text-gray-400 font-light not-italic text-xs ml-1 uppercase">Digital</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuotationTemplate;
