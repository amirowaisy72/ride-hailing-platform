"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
    MAP_PIN_STYLES,
    createDestinationPinElement,
    createDriverPinElement,
    createPersonPinElement,
} from "@/components/mapMarkerArt";

export default function ParcelTrackingMap({
    latitude,
    longitude,
    pickup,
    destination,
    vehicleType = null,
}) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const markerRef = useRef(null);
    const routeRequestRef = useRef(0);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: "https://tiles.openfreemap.org/styles/liberty",
            center: [longitude, latitude],
            zoom: 14,
        });

        const marker = new maplibregl.Marker({
            element: createDriverPinElement(vehicleType),
        })
            .setLngLat([longitude, latitude])
            .addTo(map);

        map.addControl(new maplibregl.NavigationControl(), "top-right");

        mapRef.current = map;
        markerRef.current = marker;

        return () => {
            marker.remove();
            map.remove();
            markerRef.current = null;
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) return;

        markerRef.current?.setLngLat([longitude, latitude]);
        mapRef.current?.easeTo({
            center: [longitude, latitude],
            duration: 800,
        });
    }, [latitude, longitude]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const markers = [];

        for (const [point, createElement] of [
            [pickup, () => createPersonPinElement("Parcel pickup")],
            [destination, () => createDestinationPinElement("Parcel destination")],
        ]) {
            const coords = point?.coordinates;

            if (
                !Array.isArray(coords) ||
                coords.length !== 2 ||
                !coords.every(Number.isFinite)
            ) continue;

            markers.push(
                new maplibregl.Marker({ element: createElement() })
                    .setLngLat(coords)
                    .addTo(map)
            );
        }

        return () => markers.forEach((marker) => marker.remove());
    }, [pickup, destination]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const requestId = ++routeRequestRef.current;
        const start = pickup?.coordinates;
        const end = destination?.coordinates;

        if (
            ![start, end].every(
                (p) => Array.isArray(p) &&
                    p.length === 2 &&
                    p.every(Number.isFinite)
            )
        ) return;

        const sourceId = "parcel-road-route";
        const layerId = "parcel-road-route-line";

        async function drawRoute() {
            try {
                const url =
                    `https://router.project-osrm.org/route/v1/driving/` +
                    `${start.join(",")};${end.join(",")}` +
                    `?overview=full&geometries=geojson`;

                const response = await fetch(url);
                if (!response.ok) return;

                const data = await response.json();
                if (requestId !== routeRequestRef.current) return;

                const geometry = data.routes?.[0]?.geometry;
                if (!geometry) return;

                const render = () => {
                    if (!map.isStyleLoaded()) return;

                    const source = map.getSource(sourceId);

                    const routeData = {
                        type: "Feature",
                        properties: {},
                        geometry,
                    };

                    if (source) {
                        source.setData(routeData);
                    } else {
                        map.addSource(sourceId, {
                            type: "geojson",
                            data: routeData,
                        });

                        map.addLayer({
                            id: layerId,
                            type: "line",
                            source: sourceId,
                            paint: {
                                "line-color": "#111111",
                                "line-width": 5,
                                "line-opacity": 0.85,
                            },
                        });
                    }

                    const bounds = new maplibregl.LngLatBounds();
                    geometry.coordinates.forEach((p) => bounds.extend(p));

                    map.fitBounds(bounds, {
                        padding: {
                            top: 100,
                            bottom: 310,
                            left: 45,
                            right: 45,
                        },
                        maxZoom: 15,
                        duration: 800,
                    });
                };

                if (map.isStyleLoaded()) render();
                else map.once("load", render);
            } catch {
                // Keep tracking available if routing fails.
            }
        }

        drawRoute();

        return () => {
            routeRequestRef.current++;
        };
    }, [pickup, destination]);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 h-full w-full"
        >
            <style>{MAP_PIN_STYLES}</style>
        </div>
    );
}