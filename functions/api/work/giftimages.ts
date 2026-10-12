import { work } from '../../_lib/work/route';
import { depsFor, giftImagesResponse } from '../../_lib/work/giftimages-svc';

// Gift images: the gifts whose check or letter image belongs in Blackbaud, from the D1 copy and what the hub knows. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx, env }) => giftImagesResponse(ctx, depsFor(env)) as any);
