// ==========================================
// Nyando Basin Flood Mapping with Chart
// RGB + SAR + Land Cover + Bar Chart Output
// ==========================================

// 1. Define AOI
var nyando = ee.Geometry.Rectangle([34.85, -0.25, 35.3, -0.05]);
Map.centerObject(nyando, 11);
Map.setOptions('HYBRID');

// 2. Date Ranges
var floodStart = '2022-05-01';
var floodEnd = '2022-05-20';
var refStart = '2022-03-15';
var refEnd = '2022-03-30';

// 3. Sentinel-2 RGB (Post-Flood)
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(nyando)
  .filterDate(floodStart, floodEnd)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
  .median()
  .clip(nyando);
var rgb = s2.select(['B4', 'B3', 'B2']).divide(10000);
Map.addLayer(rgb, {min: 0.0, max: 0.3}, 'RGB - Sentinel-2');

// 4. Sentinel-1 SAR Pre/Post
function getS1(start, end) {
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(nyando)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH']);
}
var pre = getS1(refStart, refEnd).median();
var post = getS1(floodStart, floodEnd).median();

// 5. Speckle Filtering
function smooth(img) {
  return img.focal_mean(30, 'circle', 'meters');
}
var preVV = smooth(pre.select('VV'));
var postVV = smooth(post.select('VV'));
var preVH = smooth(pre.select('VH'));
var postVH = smooth(post.select('VH'));

// 6. Post-Flood VV Display
Map.addLayer(postVV.clip(nyando), {min: -25, max: 0, palette: ['white', 'black']}, 'SAR VV - Post Flood');

// 7. Compute NDR and Flood Mask
var ndrVV = postVV.subtract(preVV).divide(postVV.add(preVV));
var ndrVH = postVH.subtract(preVH).divide(postVH.add(preVH));
var ndrMin = ndrVV.min(ndrVH).rename('NDR');

var srtm = ee.Image('USGS/SRTMGL1_003');
var lowlands = srtm.lt(1200).clip(nyando).selfMask();
var floodMask = ndrMin.lt(-0.25).and(lowlands).selfMask().clip(nyando);
Map.addLayer(floodMask, {palette: ['blue']}, 'Flood Mask');

// 8. ESA WorldCover Land Cover
var landcover = ee.Image("ESA/WorldCover/v100/2020").clip(nyando);
Map.addLayer(landcover, {min: 10, max: 100, palette: [
  '006400','ffbb22','ffff4c','f096ff','fa0000','b4b4b4',
  'f0f0f0','0064c8','0096a0','00cf75','fae6a0','58481f','0096a0','ffffff'
]}, 'Land Cover');

// 9. Mask land cover to flooded zones
var floodedLandCover = landcover.updateMask(floodMask);

// 10. Calculate flooded area per class
var stats = floodedLandCover.reduceRegion({
  reducer: ee.Reducer.frequencyHistogram(),
  geometry: nyando,
  scale: 10,
  maxPixels: 1e9
});
print('Flooded Area Histogram by Land Cover Class', stats);

// 11. Map codes to readable names
var lcNames = {
  '10': 'Tree Cover',
  '20': 'Shrubland',
  '30': 'Grassland',
  '40': 'Cropland',
  '50': 'Built-up',
  '60': 'Bare/Sparse Veg',
  '80': 'Water',
  '90': 'Wetlands',
  '95': 'Mangrove',
  '100': 'Moss/Lichen'
};

// 12. Generate Chart
stats.evaluate(function(res) {
  var hist = res['Map'];
  if (!hist) {
    print('⚠️ No flooded area detected.');
    return;
  }

  var chartData = [['Land Cover Type', 'Flooded Area (ha)']];
  Object.keys(hist).forEach(function(code) {
    var name = lcNames[code] || ('Class ' + code);
    var ha = hist[code] * 0.01;
    chartData.push([name, ha]);
  });

  var chart = ui.Chart(chartData)
    .setChartType('ColumnChart')
    .setOptions({
      title: 'Flooded Area by Land Cover Type',
      hAxis: {title: 'Land Cover'},
      vAxis: {title: 'Flooded Area (ha)'},
      legend: {position: 'none'},
      colors: ['#1f77b4']
    });

  print(chart);
});
