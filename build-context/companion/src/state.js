const state = {
  connected:false, game:null, updatedAt:null, sdk:{},
  truck:{}, trailer:{}, job:{}, navigation:{}, positioning:{},
  damage:{}, systems:{}, instruments:{}, warnings:{}, raw:{}, buildProfile:{}, buildPrivacy:{shareIdentity:true,shareSpecs:true,shareTrailer:true,shareCustom:false,sharePlate:false,shareLocation:true,shareSpeed:true,shareStatus:true,shareRoute:true,shareDamage:false}
};

const toMph = v => Number.isFinite(Number(v)) ? Number(v) * 2.2369362921 : null;
const lToGal = v => Number.isFinite(Number(v)) ? Number(v) * 0.2641720524 : null;
const mToMi = v => Number.isFinite(Number(v)) ? Number(v) / 1609.344 : null;
const kmToMi = v => Number.isFinite(Number(v)) ? Number(v) * 0.6213711922 : null;
const bi = v => typeof v === 'bigint' ? v.toString() : (v ?? null);
const n = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const pct = v => Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v) * 100)) : null;

function mergeTelemetry(data) {
  if (!data) return state;

  state.connected = Boolean(data.sdkActive ?? true);
  state.updatedAt = new Date().toISOString();
  state.raw = JSON.parse(JSON.stringify(data, (_,v)=>typeof v === 'bigint' ? v.toString() : v));
  state.game = data.game === 2 ? 'ATS' : data.game === 1 ? 'ETS2' : String(data.game ?? 'Unknown');

  state.sdk = {
    active:Boolean(data.sdkActive),
    paused:Boolean(data.paused),
    pluginRevision:data.telemetryPluginRevision ?? null,
    gameTelemetryMajor:data.telemetryVersionGameMajor ?? null,
    gameTelemetryMinor:data.telemetryVersionGameMinor ?? null,
    gameTimeMinutes:data.timeAbs ?? null,
    deliveryDeadlineMinutes:data.timeAbsDelivery ?? null,
    multiplayerTimeOffset:bi(data.multiplayerTimeOffset)
  };

  state.truck = {
    make:data.truckBrand || data.truckBrandId || null,
    model:data.truckName || data.truckId || null,
    id:data.truckId || null,
    licensePlate:data.truckLicensePlate || null,
    licensePlateCountry:data.truckLicensePlateCountry || null,
    speedMph:toMph(data.speed),
    speedMps:data.speed ?? null,
    rpm:data.engineRpm ?? data.rpm ?? null,
    rpmMax:data.engineRpmMax ?? null,
    gear:data.gear ?? null,
    displayedGear:data.gearDashboard ?? data.displayedGear ?? null,
    fuelGallons:lToGal(data.fuel),
    fuelLiters:data.fuel ?? null,
    fuelCapacityGallons:lToGal(data.fuelCapacity),
    fuelCapacityLiters:data.fuelCapacity ?? null,
    fuelRangeMiles:kmToMi(data.fuelRange),
    fuelAvgConsumption:data.fuelAvgConsumption ?? null,
    odometerMiles:kmToMi(data.truckOdometer),
    odometerKm:data.truckOdometer ?? null,
    engineOn:data.engineEnabled ?? null,
    electricOn:data.electricEnabled ?? null,
    parkBrake:data.parkBrake ?? null,
    motorBrake:data.motorBrake ?? null,
    retarderLevel:data.retarderBrake ?? null,
    retarderSteps:data.retarderStepCount ?? null,
    cruiseControl:Boolean(data.cruiseControl),
    cruiseControlMph:toMph(data.cruiseControlSpeed),
    differentialLock:Boolean(data.differentialLock),
    liftAxle:Boolean(data.liftAxle),
    liftAxleIndicator:Boolean(data.liftAxleIndicator),
    transmissionType:data.shifterType || null,
    forwardGears:n(data.gears),
    reverseGears:n(data.gearsReverse),
    differentialRatio:n(data.gearDifferential),
    forwardGearRatios:Array.isArray(data.gearRatiosForward) ? data.gearRatiosForward.filter(v=>Number(v)>0) : [],
    reverseGearRatios:Array.isArray(data.gearRatiosReverse) ? data.gearRatiosReverse.filter(v=>Number(v)>0) : [],
    wheelCount:n(data.wheelCount),
    poweredWheels:Array.isArray(data.wheelPowered) ? data.wheelPowered.filter(Boolean).length : null,
    steerableWheels:Array.isArray(data.wheelSteerable) ? data.wheelSteerable.filter(Boolean).length : null,
    liftableWheels:Array.isArray(data.wheelLiftable) ? data.wheelLiftable.filter(Boolean).length : null,
    wheelRadiusMeters:Array.isArray(data.wheelRadius) ? data.wheelRadius.filter(v=>Number(v)>0) : []
  };

  const trailer = Array.isArray(data.trailers) ? (data.trailers.find(t=>t?.attached) || data.trailers[0]) : null;
  state.trailer = {
    attached:Boolean(trailer?.attached),
    id:trailer?.id || null,
    brand:trailer?.brand || null,
    name:trailer?.name || null,
    chainType:trailer?.chainType || null,
    licensePlate:trailer?.licensePlate || null,
    licensePlateCountry:trailer?.licensePlateCountry || null,
    wheelCount:n(trailer?.wheelCount),
    steerableWheels:Array.isArray(trailer?.wheelSteerable) ? trailer.wheelSteerable.filter(Boolean).length : null,
    poweredWheels:Array.isArray(trailer?.wheelPowered) ? trailer.wheelPowered.filter(Boolean).length : null,
    liftableWheels:Array.isArray(trailer?.wheelLiftable) ? trailer.wheelLiftable.filter(Boolean).length : null,
    cargoDamage:trailer?.cargoDamage ?? data.cargoDamage ?? null,
    wearBody:trailer?.wearBody ?? null,
    wearChassis:trailer?.wearChassis ?? null,
    wearWheels:trailer?.wearWheels ?? null,
    liftAxle:Boolean(data.trailerLiftAxle),
    liftAxleIndicator:Boolean(data.trailerLiftAxleIndicator)
  };

  state.job = {
    active:Boolean(data.onJob),
    cargo:data.cargo || null,
    cargoId:data.cargoId || null,
    cargoMassKg:data.cargoMass ?? null,
    originCity:data.citySrc || null,
    originCompany:data.compSrc || null,
    destinationCity:data.cityDst || null,
    destinationCompany:data.compDst || null,
    income:bi(data.jobIncome),
    plannedDistanceMiles:kmToMi(data.plannedDistanceKm),
    cargoDamage:data.cargoDamage ?? null,
    market:data.jobMarket || null,
    specialJob:Boolean(data.specialJob),
    startingTimeMinutes:data.jobStartingTime ?? null,
    deliveryDeadlineMinutes:data.timeAbsDelivery ?? null
  };

  const remainingMiles = mToMi(data.routeDistance);
  const plannedMiles = kmToMi(data.plannedDistanceKm);
  const progress = (plannedMiles && remainingMiles != null && plannedMiles > 0)
    ? Math.max(0, Math.min(100, (1 - remainingMiles / plannedMiles) * 100))
    : null;

  state.navigation = {
    distanceMiles:remainingMiles,
    distanceMeters:data.routeDistance ?? null,
    etaSeconds:data.routeTime ?? null,
    restStopMinutes:n(data.restStop),
    speedLimitMph:toMph(data.speedLimit),
    plannedDistanceMiles:plannedMiles,
    progressPercent:progress,
    deadlineMinutesRemaining:
      Number.isFinite(Number(data.timeAbsDelivery)) && Number.isFinite(Number(data.timeAbs))
        ? Number(data.timeAbsDelivery) - Number(data.timeAbs)
        : null,
    nativeTurnInstructionAvailable:false
  };

  state.positioning = {
    x:data.coordinateX ?? null,
    y:data.coordinateY ?? null,
    z:data.coordinateZ ?? null,
    rotationX:data.rotationX ?? null,
    rotationY:data.rotationY ?? null,
    rotationZ:data.rotationZ ?? null
  };

  state.damage = {
    enginePercent:pct(data.wearEngine),
    transmissionPercent:pct(data.wearTransmission),
    cabinPercent:pct(data.wearCabin),
    chassisPercent:pct(data.wearChassis),
    wheelsPercent:pct(data.wearWheels),
    cargoPercent:pct(data.cargoDamage),
    trailerBodyPercent:pct(trailer?.wearBody),
    trailerChassisPercent:pct(trailer?.wearChassis),
    trailerWheelsPercent:pct(trailer?.wearWheels)
  };

  state.systems = {
    lights:{
      parking:Boolean(data.lightsParking),
      lowBeam:Boolean(data.lightsBeamLow),
      highBeam:Boolean(data.lightsBeamHigh),
      auxFront:Number(data.lightsAuxFront || 0),
      auxRoof:Number(data.lightsAuxRoof || 0),
      beacon:Boolean(data.lightsBeacon),
      brake:Boolean(data.lightsBrake),
      reverse:Boolean(data.lightsReverse),
      hazards:Boolean(data.lightsHazard),
      leftBlinkerActive:Boolean(data.blinkerLeftActive),
      rightBlinkerActive:Boolean(data.blinkerRightActive),
      leftBlinkerOn:Boolean(data.blinkerLeftOn),
      rightBlinkerOn:Boolean(data.blinkerRightOn),
      dashboard:Number(data.lightsDashboard || 0)
    },
    wipers:Boolean(data.wipers),
    parkingBrake:Boolean(data.parkBrake),
    engineBrake:Boolean(data.motorBrake),
    cruiseControl:Boolean(data.cruiseControl),
    differentialLock:Boolean(data.differentialLock),
    liftAxle:Boolean(data.liftAxle),
    trailerLiftAxle:Boolean(data.trailerLiftAxle)
  };

  state.instruments = {
    airPressurePsi:n(data.airPressure),
    brakeTemperatureC:n(data.brakeTemperature),
    oilPressurePsi:n(data.oilPressure),
    oilTemperatureC:n(data.oilTemperature),
    waterTemperatureC:n(data.waterTemperature),
    batteryVoltage:n(data.batteryVoltage),
    adblueLiters:n(data.adblue),
    adblueCapacityLiters:n(data.adblueCapacity),
    throttle:Number(data.userThrottle ?? data.gameThrottle ?? 0) * 100,
    brake:Number(data.userBrake ?? data.gameBrake ?? 0) * 100,
    clutch:Number(data.userClutch ?? data.gameClutch ?? 0) * 100,
    steering:Number(data.userSteer ?? data.gameSteer ?? 0) * 100
  };

  state.warnings = {
    fuel:Boolean(data.fuelWarning),
    adblue:Boolean(data.adblueWarning),
    airPressure:Boolean(data.airPressureWarning),
    airPressureEmergency:Boolean(data.airPressureEmergency),
    oilPressure:Boolean(data.oilPressureWarning),
    waterTemperature:Boolean(data.waterTemperatureWarning),
    batteryVoltage:Boolean(data.batteryVoltageWarning)
  };

  return state;
}

function markDisconnected(){
  state.connected=false;
  state.updatedAt=new Date().toISOString();
}

module.exports = { state, mergeTelemetry, markDisconnected };
