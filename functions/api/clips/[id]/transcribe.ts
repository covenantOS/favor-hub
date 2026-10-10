// Read one audio slice while the recording is still going. Optional: the final pass reads whatever is left.
import { errorJson, handleError, json } from '../../../_lib/http';
import { J, staffOrError, ownClip, type AudioSeg, type ClipsEnv } from '../../../_lib/clips';
import { transcribeSlice } from '../../../_lib/clipai';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const n = Number(new URL(request.url).searchParams.get('n'));
    const slices = J<AudioSeg[]>(clip.audio_segments, []).sort((a, b) => a.n - b.n);
    const idx = slices.findIndex((s) => s.n === n);
    if (idx < 0) return errorJson('no_slice', 'No such slice.', 404);
    try {
      const got = await transcribeSlice(env, clip, slices[idx], slices[idx + 1]?.start ?? (clip.duration_ms / 1000 || slices[idx].start + 240));
      return json({ ok: got !== null, lines: got?.lines.length ?? 0 });
    } catch (err) {
      console.warn('[clips] slice', err);
      return json({ ok: false, lines: 0 });
    }
  } catch (err) {
    return handleError(err);
  }
};
