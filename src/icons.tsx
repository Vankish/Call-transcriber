// ── Iconos ─────────────────────────────────────────────────────────────────
// Un solo juego propio, trazo de 2 y esquinas redondeadas, para no mezclar
// emoji del sistema (que además cambian de un equipo a otro, y las banderas ni
// se dibujan en Windows) con dibujos nuestros. Todos aceptan `size` y heredan
// el color del texto al que acompañan.
const svgBase = { verticalAlign: 'middle' as const, flexShrink: 0 }
type IconProps = { size?: number }
const stroke = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: svgBase,
})
const solid = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', style: svgBase })

export const TrashIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
export const CheckIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)} strokeWidth={3}><polyline points="20 6 9 17 4 12"/></svg>
export const CloseIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)} strokeWidth={2.5}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
export const RefreshIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
export const PencilIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
export const PlayIcon = ({ size = 15 }: IconProps) => <svg {...solid(size)}><polygon points="5 3 19 12 5 21 5 3"/></svg>
export const PauseIconSm = ({ size = 15 }: IconProps) => <svg {...solid(size)}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
export const HomeIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
export const FolderIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
export const SettingsIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
export const UserIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
export const ChevronRight = ({ size = 12 }: IconProps) => <svg {...stroke(size)} strokeWidth={2.5}><polyline points="9 18 15 12 9 6"/></svg>
export const ChevronLeft = ({ size = 14 }: IconProps) => <svg {...stroke(size)} strokeWidth={2.5}><polyline points="15 18 9 12 15 6"/></svg>
export const ArrowRightIcon = ({ size = 14 }: IconProps) => <svg {...stroke(size)}><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
export const ArrowLeftIcon = ({ size = 14 }: IconProps) => <svg {...stroke(size)}><line x1="20" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/></svg>
export const SearchIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
export const DownloadIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
export const UploadIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
export const UsersIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
export const KeyIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><circle cx="8" cy="15" r="5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>
export const MicIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
export const VideoIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
export const MonitorIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
export const LockIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
export const BellIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
export const StarIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
export const DocIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
export const ClipboardIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
export const CameraIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
export const LogoutIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
export const CloudIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
export const CloudUploadIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><path d="M20 16.6A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><polyline points="9 13 12 10 15 13"/><line x1="12" y1="10" x2="12" y2="21"/></svg>
export const InfoIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
export const CircleIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><circle cx="12" cy="12" r="9"/></svg>
export const TargetIcon = ({ size = 16 }: IconProps) => <svg {...stroke(size)}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
export const SparkIcon = ({ size = 12 }: IconProps) => <svg {...solid(size)}><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>
export const ListViewIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
export const GridViewIcon = ({ size = 15 }: IconProps) => <svg {...stroke(size)}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>

export const DotFilled = ({ size = 8 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 8 8" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
export const DotRing = ({ size = 8 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 8 8" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
export const SquareFilled = ({ size = 8 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 8 8" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><rect width="8" height="8" rx="1" fill="currentColor"/></svg>
export const WarnTriangle = ({ size = 12 }: IconProps) => <svg {...stroke(size)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
