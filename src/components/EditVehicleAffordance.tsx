/**
 * EditVehicleAffordance — the "Edit this vehicle" reveal-on-selection pill that
 * sits directly ABOVE the bottom VehicleMenu rail (VISION.md:19).
 *
 * VISION is literal: clicking a vehicle in the bottom selector should surface an
 * "Edit this vehicle" affordance ABOVE the selector that opens the texture
 * editor for that vehicle. Previously the entry point was a permanent pill in
 * the mid control row (next to the SeasonToggle); this component relocates that
 * entry point to a dedicated row just above the VehicleMenu and labels it with
 * the currently-selected vehicle's name (e.g. "Edit Tiger I").
 *
 * Design (PHASE2-PLAN.md, Slice 2, Option A): this is a THIN positioning
 * wrapper around the existing `EditTextureButton`. Reusing that button keeps the
 * glass-pill + l01-ring styling, the gold/green active treatment, the
 * `aria-label`/`aria-pressed`/`title` contract, and — critically — the pinned
 * `data-testid="edit-texture-pill"` that the harness and the standalone
 * `EditTextureButton.test` key off. The only new behavior here is the label and
 * the reveal-on-selection guard: with no vehicle selected we render nothing so
 * the affordance only appears once a vehicle is chosen.
 */

import EditTextureButton from './EditTextureButton'

interface Props {
  /**
   * Display name of the currently-selected vehicle (e.g. "Tiger I"). When null
   * (no selection) the affordance renders nothing — it only appears once a
   * vehicle is chosen, matching "clicking a vehicle … surfaces" the affordance.
   */
  vehicleName: string | null
  /** Opens the vehicle-texture editor for the selected vehicle. */
  onEdit: () => void
  /** True while the texture editor is open (drives the pressed/green styling). */
  editing: boolean
  /** Disable while no vehicle is loaded (there's nothing to paint on). */
  disabled?: boolean
}

export default function EditVehicleAffordance({
  vehicleName,
  onEdit,
  editing,
  disabled = false,
}: Props) {
  // Reveal-on-selection: no vehicle name → no affordance.
  if (vehicleName == null) return null

  return (
    <div className="flex items-center justify-center">
      <EditTextureButton
        brushOn={editing}
        onClick={onEdit}
        disabled={disabled}
        label={`Edit ${vehicleName}`}
      />
    </div>
  )
}
