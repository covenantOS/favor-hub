// Lets Node load the Pages Functions as they are written: their relative imports leave off the
// ".ts" extension, which Wrangler's bundler fills in and Node does not. Imported by a test before
// it loads a route with a dynamic import.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
