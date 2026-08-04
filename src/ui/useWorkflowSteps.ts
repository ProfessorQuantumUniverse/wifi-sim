import { metresPerPixel, useFloorplanStore } from '../state/store'
import { useSceneStore } from '../state/sceneStore'
import { useSimStore } from '../state/simStore'
import type { Step } from './Workflow'

/**
 * Derives the workflow state from the stores, so every panel shows the same
 * picture of what is done and what is next.
 */
export function useWorkflowSteps(): Step[] {
  const image = useFloorplanStore((s) => s.image)
  const walls = useFloorplanStore((s) => s.walls)
  const calibration = useFloorplanStore((s) => s.calibration)
  const sceneWalls = useSceneStore((s) => s.scene.walls.length)
  const aps = useSimStore((s) => s.aps.length)
  const heatmap = useSimStore((s) => s.heatmap)

  const hasImage = !!image
  const hasTrace = walls.length > 0
  const hasScale = metresPerPixel(calibration) !== null
  const hasModel = sceneWalls > 0
  const hasAp = aps > 0

  const state = (done: boolean, ready: boolean): Step['state'] =>
    done ? 'done' : ready ? 'current' : 'blocked'

  return [
    {
      label: 'Load the floorplan',
      state: state(hasImage, true),
      hint: 'Floorplan tab → “Load floorplan…”, or drag an image onto the canvas.',
    },
    {
      label: 'Trace the walls',
      state: state(hasTrace, hasImage),
      hint: 'Floorplan tab → adjust the sliders until only the walls are red, then press “Trace walls”.',
    },
    {
      label: 'Set the scale',
      state: state(hasScale, hasImage),
      hint: 'Floorplan tab → Scale → “Pick two points”, click both ends of a known dimension, type its length in metres.',
    },
    {
      label: 'Build the model',
      state: state(hasModel, hasTrace && hasScale),
      hint: 'Press “Build model →” in the header, then check wall build-ups and add windows and doors.',
    },
    {
      label: 'Place a router and compute',
      state: state(!!heatmap, hasModel),
      hint: hasAp
        ? 'Simulate tab → “Compute coverage”.'
        : 'Simulate tab → “+ Place AP”, click where your router sits, then “Compute coverage”.',
    },
  ]
}
