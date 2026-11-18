import { BrandLockup, BrandMark, brand } from "../brand"

/** Brand lockup at the top of the session sidebar (macOS and Linux, where the sidebar owns the top row). */
export function SidebarBrand() {
  return (
    <div data-component="panacode-sidebar-brand" data-tauri-drag-region title={brand.name}>
      <BrandLockup size={20} />
    </div>
  )
}

/** Compact mark + wordmark in the window titlebar (Windows, where the native controls own that row). */
export function TitlebarBrand() {
  return (
    <div data-component="panacode-titlebar-brand" aria-label={brand.name} data-tauri-drag-region>
      <BrandMark size={16} />
      <span data-slot="name">{brand.name}</span>
    </div>
  )
}
