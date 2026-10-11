const ServiceArea = require("../models/ServiceArea");

const isLocationSupported = async (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 || lat > 90 ||
    lng < -180 || lng > 180
  ) {
    throw new Error("Invalid coordinates");
  }

  const area = await ServiceArea.findOne({
    active: true,
    polygon: {
      $geoIntersects: {
        $geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
      },
    },
  }).select("_id name city");

  return {
    supported: Boolean(area),
    serviceArea: area || null,
  };
};

module.exports = { isLocationSupported };