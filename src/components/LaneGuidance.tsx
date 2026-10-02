import { laneArrowPaths, type LaneGuidance as Guidance } from '@/lib/lane-guidance'
import { formatDistance } from '@/lib/navigation'

const directionLabels: Record<string, string> = {
  straight: 'rast', left: 'çep', right: 'rastê', 'slight left': 'hinekî çep',
  'slight right': 'hinekî rastê', 'sharp left': 'tûj çep', 'sharp right': 'tûj rastê',
  uturn: 'veger', none: 'bê nîşan',
}

export default function LaneGuidance({ guidance }: { guidance: Guidance }) {
  return (
    <section className="lane-guidance" aria-label="Rêberiya şerîtan">
      <div className="lane-guidance-heading"><strong>Şerîtên rê</strong><span>{formatDistance(guidance.distance)}</span></div>
      <div className="lane-guidance-road">
        {guidance.lanes.map((lane, index) => (
          <div className={`lane-guidance-lane${lane.valid ? ' lane-guidance-lane--recommended' : ''}`} key={index}>
            <svg viewBox="-7 -12 14 16" role="img" aria-label={`Şerîta ${index + 1}: ${lane.indications.map((direction) => Object.hasOwn(directionLabels, direction) ? directionLabels[direction] : 'nîşana nenas').join(', ')}${lane.valid ? ' — tê pêşniyarkirin' : ''}`}>
              {lane.indications.flatMap((direction) => (Object.hasOwn(laneArrowPaths, direction) ? laneArrowPaths[direction] : []).map((path, pathIndex) => (
                <polyline key={`${direction}-${pathIndex}`} points={path.map(([horizontal, forward]) => `${horizontal},${-forward}`).join(' ')} />
              )))}
            </svg>
            {lane.valid && <span className="lane-guidance-check" aria-hidden="true">✓</span>}
          </div>
        ))}
      </div>
      {guidance.lanes.some((lane) => lane.valid) && <p>Şerîtên kesk hilbijêre</p>}
    </section>
  )
}
