/** ----------------------- sanitisers ----------------------- **/
var sanitisers = {};
sanitisers.doc      = require('../sanitiser/doc');
sanitisers.suggest  = require('../sanitiser/suggest');
sanitisers.search   = require('../sanitiser/search');
sanitisers.coarse   = require('../sanitiser/coarse');
sanitisers.reverse  = require('../sanitiser/reverse');

/** ---------------------- routing --------------------------- **/
var routers = {};
routers.semver = require('../middleware/semver');

/** ----------------------- controllers ----------------------- **/

var controllers     = {};
controllers.index   = require('../controller/index');
controllers.doc     = require('../controller/doc');
controllers.search  = require('../controller/search');

function addRoutes(app, peliasConfig) {
  // api root
  app.get( '/:vr/', controllers.index() );

  // doc API
  app.get( '/:vr/doc', sanitisers.doc.middleware, controllers.doc() );

  // suggest APIs
  app.get( '/:vr/suggest', sanitisers.search.middleware, controllers.search() );
  app.get( '/:vr/suggest/nearby', sanitisers.suggest.middleware, controllers.search() );
  app.get( '/:vr/suggest/coarse', sanitisers.coarse.middleware, controllers.search() );

  // search APIs
  app.get( '/:vr/search', routers.semver(peliasConfig), sanitisers.search.middleware, controllers.search() );
  app.get( '/:vr/search/coarse', sanitisers.coarse.middleware, controllers.search() );

  // reverse API
  app.get( '/:vr/reverse', sanitisers.reverse.middleware, controllers.search(undefined, require('../query/reverse')) );
}

module.exports.addRoutes = addRoutes;
