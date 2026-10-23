'use strict';

const drawings=L.featureGroup().addTo(map);
const routes=L.featureGroup().addTo(map);
const pinIcon=L.divIcon({className:'drawing-pin',iconSize:[14,14],iconAnchor:[7,7]});
const drawControl=new L.Control.Draw({
  position:'topleft',
  draw:{
    polyline:{shapeOptions:{color:'#c9a84c'}},
    polygon:{allowIntersection:false,shapeOptions:{color:'#c9a84c'}},
    rectangle:{shapeOptions:{color:'#c9a84c'}},
    marker:{icon:pinIcon},circle:false,circlemarker:false
  },
  edit:{featureGroup:drawings}
});
map.addControl(drawControl);
L.control.zoom({position:'bottomright'}).addTo(map);
let activePick=null, activeDraw=null, drawingShip=false, routePending=false;
const routeStatus=document.getElementById('routeStatus');
const routeMode=document.getElementById('routeMode');
const buildButton=document.getElementById('buildRoute');
const allFeatures=()=>[...drawings.getLayers(),...routes.getLayers()];

function finishPick(){
  activePick=null;
  document.querySelectorAll('.pick-btn').forEach(button=>button.classList.remove('active'));
  document.getElementById('map').style.cursor='';
}

function bindFeaturePopup(layer){
  const properties=layer.feature.properties;
  const text=document.createElement('span');
  text.textContent=properties.name+'\n'+properties.source+(properties.estimated ? ' · estimated' : '');
  layer.bindPopup(text);
}

function refreshFeatures(){
  const list=document.getElementById('featureList');
  list.replaceChildren();
  const layers=allFeatures();
  document.getElementById('drawingStatus').textContent=layers.length
    ? `${layers.length} feature${layers.length===1?'':'s'} ready to export. Drawings can be edited with the map toolbar.`
    : 'No features yet. Draw on the map to begin.';
  layers.forEach(layer=>{
    const properties=layer.feature.properties;
    const row=document.createElement('div'); row.className='feature-row';
    const focus=document.createElement('button'); focus.className='feature-focus';
    focus.textContent=properties.name;
    const detail=document.createElement('small');
    detail.textContent=(properties.transport || layer.toGeoJSON().geometry.type)+(properties.estimated?' · estimated':'');
    focus.appendChild(detail);
    focus.addEventListener('click',()=>{
      if(layer.getBounds) map.fitBounds(layer.getBounds(),{padding:[35,35],maxZoom:14});
      else map.setView(layer.getLatLng(),12);
      layer.openPopup();
    });
    const remove=document.createElement('button'); remove.className='feature-remove'; remove.textContent='✕';
    remove.setAttribute('aria-label','Delete '+properties.name);
    remove.addEventListener('click',()=>{
      if(drawControl._toolbars.edit._activeMode){notify('Save or cancel your map edits first');return;}
      drawings.removeLayer(layer); routes.removeLayer(layer); refreshFeatures();
    });
    row.append(focus,remove); list.appendChild(row);
  });
}

map.on(L.Draw.Event.CREATED,event=>{
  const layer=event.layer;
  const ship=drawingShip && event.layerType==='polyline';
  const name=document.getElementById('featureName').value.trim() || (ship?'Ship route':`Drawing ${drawings.getLayers().length+1}`);
  layer.feature={type:'Feature',properties:{name,kind:ship?'route':'drawing',source:'User drawn',...(ship?{transport:'ship',estimated:false,navigation_safe:false}:{})}};
  bindFeaturePopup(layer); drawings.addLayer(layer); refreshFeatures();
  if(ship) routeStatus.textContent='Ship waypoints added. This is a manual path, not a navigable sea route.';
  notify(name+' added');
});
map.on(L.Draw.Event.DRAWSTART,()=>finishPick());
map.on(L.Draw.Event.DRAWSTOP,()=>{activeDraw=null;drawingShip=false;});
map.on(L.Draw.Event.EDITED,refreshFeatures);
map.on(L.Draw.Event.DELETED,refreshFeatures);

for(const [id,field] of [['pickStart','routeStart'],['pickEnd','routeEnd']]){
  document.getElementById(id).addEventListener('click',()=>{
    const same=activePick===field;
    finishPick();
    if(same){routeStatus.textContent='Point selection cancelled.';return;}
    Object.values(drawControl._toolbars).forEach(toolbar=>toolbar.disable());
    if(activeDraw) activeDraw.disable();
    activePick=field;
    document.getElementById(id).classList.add('active');
    document.getElementById('map').style.cursor='crosshair';
    routeStatus.textContent=`Click the map to choose the ${field==='routeStart'?'start':'end'} point. Escape cancels.`;
  });
}
map.on('click',event=>{
  if(!activePick) return;
  document.getElementById(activePick).value=`${event.latlng.lat.toFixed(6)}, ${event.latlng.wrap().lng.toFixed(6)}`;
  finishPick(); routeStatus.textContent='Point selected.';
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && activePick){finishPick();routeStatus.textContent='Point selection cancelled.';}
});

function updateRouteMode(){
  finishPick();
  if(activeDraw) activeDraw.disable();
  const mode=routeMode.value;
  document.getElementById('routeEndpoints').hidden=mode==='ship';
  document.getElementById('routeHelp').textContent={
    driving:'A road-following route from the public OSRM demo service. No live traffic; availability is best effort.',
    flight:'An estimated great-circle path between two points. This is not an airline schedule or a recorded flight track.',
    ship:'Click along your intended path on the water, then click the last point again to finish. No sea routing or obstacle avoidance is applied.'
  }[mode];
  buildButton.textContent={driving:'Create road route',flight:'Create estimated flight path',ship:'Draw ship waypoints'}[mode];
  routeStatus.textContent='';
}
routeMode.addEventListener('change',updateRouteMode);

buildButton.addEventListener('click',async()=>{
  if(routePending) return;
  finishPick();
  Object.values(drawControl._toolbars).forEach(toolbar=>toolbar.disable());
  if(activeDraw) activeDraw.disable();
  const mode=routeMode.value;
  if(mode==='ship'){
    activeDraw=new L.Draw.Polyline(map,{shapeOptions:{color:'#4a9eff'}});
    activeDraw.enable(); drawingShip=true;
    routeStatus.textContent='Click map waypoints. Click the last point again to finish; Escape cancels.';
    return;
  }
  let timeout;
  try{
    const start=GeoJSONTools.parseCoordinate(document.getElementById('routeStart').value);
    const end=GeoJSONTools.parseCoordinate(document.getElementById('routeEnd').value);
    if(start.every((value,index)=>value===end[index])) throw new Error('Choose different start and end points.');
    const name=document.getElementById('featureName').value.trim() || (mode==='flight'?'Estimated flight path':'Driving route');
    let feature;
    if(mode==='flight'){
      const result=GeoJSONTools.flightRoute(start,end);
      feature={type:'Feature',properties:{name,kind:'route',transport:'airplane',source:'Great-circle estimate',estimated:true,distance_m:result.distance_m},geometry:result.geometry};
    } else {
      routePending=true; buildButton.disabled=true; routeMode.disabled=true;
      routeStatus.textContent='Finding a road route…';
      const controller=new AbortController(); timeout=setTimeout(()=>controller.abort(),20000);
      const response=await fetch(`https://router.project-osrm.org/route/v1/driving/${start.join(',')};${end.join(',')}?overview=full&geometries=geojson&steps=false`,{signal:controller.signal});
      if(!response.ok) throw new Error(`Road routing service returned HTTP ${response.status}. Try again later.`);
      feature=GeoJSONTools.roadFeature(await response.json(),name);
    }
    const group=L.geoJSON(feature,{style:{color:mode==='flight'?'#c9a84c':'#4a9eff',weight:4,dashArray:mode==='flight'?'8 6':undefined}});
    group.eachLayer(layer=>{bindFeaturePopup(layer);routes.addLayer(layer);});
    refreshFeatures(); map.fitBounds(group.getBounds(),{padding:[30,30],maxZoom:14});
    routeStatus.textContent=`${name} added · ${(feature.properties.distance_m/1000).toFixed(1)} km${mode==='flight'?' · estimated':''}. Ready for GeoJSON export.`;
  } catch(error){
    routeStatus.textContent=error.name==='AbortError'
      ? 'Road routing timed out. Check your connection and try again.'
      : error instanceof TypeError
        ? 'Cannot reach the road routing service. Check Internet access to router.project-osrm.org and try again.'
        : error.message;
  } finally {
    clearTimeout(timeout); routePending=false; buildButton.disabled=false; routeMode.disabled=false;
  }
});

document.getElementById('exportGeoJSON').addEventListener('click',()=>{
  const layers=allFeatures();
  if(!layers.length){notify('Draw a feature or create a route first');return;}
  if(drawControl._toolbars.edit._activeMode){notify('Save or cancel your map edits before exporting');return;}
  const data={type:'FeatureCollection',features:layers.map(layer=>layer.toGeoJSON(6))};
  // RFC 7946 uses longitude, latitude; coordinate export is independent of the camera sequence.
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'}));
  const link=document.createElement('a'); link.href=url; link.download='geolayer-features.geojson';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify(`${layers.length} features exported as GeoJSON`);
});
updateRouteMode(); refreshFeatures();
