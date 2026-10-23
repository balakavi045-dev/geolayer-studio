const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseCoordinate,flightRoute,roadFeature}=require('../geojson.js');

test('latitude-first inputs become GeoJSON longitude-first coordinates',()=>{
  assert.deepEqual(parseCoordinate('13.0827, 80.2707'),[80.2707,13.0827]);
  for(const text of ['',',','91,0','0,181','NaN,20','13,80,2','13,'])
    assert.throws(()=>parseCoordinate(text));
});

test('flight geometry follows a great circle, preserves endpoints and reports metres',()=>{
  const result=flightRoute([0,0],[90,0]);
  assert.equal(result.geometry.type,'LineString');
  assert.deepEqual(result.geometry.coordinates[0],[0,0]);
  assert.deepEqual(result.geometry.coordinates.at(-1),[90,0]);
  assert.ok(Math.abs(result.distance_m-10007557.22)<1);
  const north=flightRoute([-60,50],[60,50]);
  assert.ok(Math.max(...north.geometry.coordinates.map(p=>p[1]))>65);
  assert.throws(()=>flightRoute([0,0],[0,0]),/different/);
  assert.throws(()=>flightRoute([0,0],[180,0]),/Opposite/);
});

test('dateline flight routes split into valid segments without wrapping across the world',()=>{
  for(const [start,end] of [[[170,35],[-170,35]],[[-170,35],[170,35]],[[180,35],[-170,35]],[[170,35],[-180,35]]]){
    const geometry=flightRoute(start,end).geometry;
    const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
    for(const line of lines){
      assert.ok(line.length>=2);
      line.forEach((point,i)=>{
        assert.ok(point.every(Number.isFinite));
        assert.ok(Math.abs(point[0])<=180 && Math.abs(point[1])<=90);
        if(i) assert.ok(Math.abs(point[0]-line[i-1][0])<=180);
      });
    }
    if(Math.abs(start[0])<180 && Math.abs(end[0])<180) assert.equal(geometry.type,'MultiLineString');
  }
});

test('OSRM geometry and metadata are preserved; unavailable and malformed routes are rejected',()=>{
  const geometry={type:'LineString',coordinates:[[80.27,13.08],[79,12.9],[77.59,12.97]]};
  const response={code:'Ok',routes:[{geometry,distance:350000,duration:21000}]};
  const feature=roadFeature(response,'Chennai to Bengaluru');
  assert.deepEqual(feature.geometry,geometry);
  assert.equal(feature.properties.transport,'car');
  assert.equal(feature.properties.source,'OpenStreetMap / OSRM');
  assert.equal(feature.properties.duration_s,21000);
  assert.equal(feature.properties.estimated,false);
  assert.throws(()=>roadFeature({code:'NoRoute',routes:[]},'none'),/No road route/);
  assert.throws(()=>roadFeature({code:'Ok',routes:[{...response.routes[0],geometry:{type:'LineString',coordinates:[[0,0],[200,20]]}}]},'invalid'),/invalid/);
});
