
var logger = require('../src/logger'),
    queries = require('geopipes-elasticsearch-backend').queries;

function generate( params ){

  var centroid = {
    lat: params.lat,
    lon: params.lon
  };

  var query = queries.envelope( centroid, { size: params.size } );

  // add search condition to distance query
  query.query.filtered.query = {
    'match_all': {}
  };

  return query;
}

module.exports = generate;