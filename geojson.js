/* Geometry helpers shared by the browser and dependency-free Node checks. */
(function(root){
  'use strict';
  const RADIUS = 6371008.8;
  const radians = value => value * Math.PI / 180;
  const degrees = value => value * 180 / Math.PI;

  function parseCoordinate(text){
    const values = text.trim().split(',');
    if(values.length !== 2 || values.some(value => !value.trim()))
      throw new Error('Enter coordinates as latitude, longitude.');
    const [lat, lng] = values.map(Number);
    if(!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180)
      throw new Error('Latitude must be −90 to 90; longitude must be −180 to 180.');
    return [lng, lat]; // RFC 7946 coordinate order
  }

  function splitAntimeridian(points){
    const lines = [[points[0]]];
    for(let i=1; i<points.length; i++){
      const previous=points[i-1], current=points[i];
      let line=lines[lines.length-1];
      if(Math.abs(current[0]-previous[0])>180){
        const adjusted=current[0]+(current[0]>previous[0] ? -360 : 360);
        const boundary=adjusted>previous[0] ? 180 : -180;
        const fraction=(boundary-previous[0])/(adjusted-previous[0]);
        const latitude=previous[1]+fraction*(current[1]-previous[1]);
        if(fraction>0) line.push([boundary,latitude]);
        line=[[-boundary,latitude]];
        lines.push(line);
        if(fraction<1) line.push(current);
      } else line.push(current);
    }
    const valid=lines.filter(line => line.length>1);
    return valid.length===1 ? {type:'LineString',coordinates:valid[0]} : {type:'MultiLineString',coordinates:valid};
  }

  function flightRoute(start,end){
    const vector=([lng,lat])=>[Math.cos(radians(lat))*Math.cos(radians(lng)),Math.cos(radians(lat))*Math.sin(radians(lng)),Math.sin(radians(lat))];
    const a=vector(start), b=vector(end);
    const dot=Math.max(-1,Math.min(1,a.reduce((sum,value,index)=>sum+value*b[index],0)));
    const angle=Math.acos(dot);
    if(angle<1e-8) throw new Error('Choose different start and end points.');
    if(Math.PI-angle<1e-6) throw new Error('Opposite points have no unique flight path. Choose a different endpoint.');
    const steps=Math.max(32,Math.ceil(degrees(angle)*2));
    const points=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps, left=Math.sin((1-t)*angle)/Math.sin(angle), right=Math.sin(t*angle)/Math.sin(angle);
      const v=a.map((value,index)=>left*value+right*b[index]);
      points.push([degrees(Math.atan2(v[1],v[0])),degrees(Math.atan2(v[2],Math.hypot(v[0],v[1])))]);
    }
    points[0]=start.slice();
    points[points.length-1]=end.slice();
    return {geometry:splitAntimeridian(points),distance_m:angle*RADIUS};
  }

  function roadFeature(response,name){
    if(response.code!=='Ok' || !response.routes?.length)
      throw new Error('No road route found. Try points closer to connected roads.');
    const route=response.routes[0], geometry=route.geometry;
    if(geometry?.type!=='LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length<2 ||
       geometry.coordinates.some(point=>!Array.isArray(point) || point.length<2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0])>180 || Math.abs(point[1])>90) ||
       !Number.isFinite(route.distance) || route.distance<0 || !Number.isFinite(route.duration) || route.duration<0)
      throw new Error('The routing service returned invalid route data.');
    return {type:'Feature',properties:{name,kind:'route',transport:'car',source:'OpenStreetMap / OSRM',estimated:false,distance_m:route.distance,duration_s:route.duration},geometry:splitAntimeridian(geometry.coordinates)};
  }

  const api={parseCoordinate,flightRoute,roadFeature,splitAntimeridian};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.GeoJSONTools=api;
})(typeof globalThis!=='undefined' ? globalThis : this);
