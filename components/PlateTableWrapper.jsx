"use client";

import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import PlateTable from "./PlateTable";
import {
  getLatestPlateReads,
  getTags,
  addKnownPlate,
  tagPlate,
  untagPlate,
  deletePlateRead,
  getCameraNames,
  correctPlateRead,
  getTimeFormat,
} from "@/app/actions";

export function PlateTableWrapper() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [timeFormat, setTimeFormat] = useState(12);

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [availableTags, setAvailableTags] = useState([]);
  const [availableCameras, setAvailableCameras] = useState([]);

  const page = searchParams.get("page") || "1";
  const pageSize = searchParams.get("pageSize") || "25";
  const search = searchParams.get("search") || "";
  const fuzzySearch = searchParams.get("fuzzySearch") === "true";
  const tag = searchParams.get("tag") || "all";
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const cameraName = searchParams.get("camera");
  const hourFrom = searchParams.get("hourFrom");
  const hourTo = searchParams.get("hourTo");

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [platesResult, tagsResult, camerasResult, timeFormatResult] =
        await Promise.all([
          getLatestPlateReads({
            page: parseInt(page),
            pageSize: parseInt(pageSize),
            search,
            fuzzySearch,
            tag,
            dateRange:
              dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null,
            hourRange:
              hourFrom && hourTo
                ? {
                    from: parseInt(hourFrom),
                    to: parseInt(hourTo),
                  }
                : null,
            cameraName,
          }),
          getTags(),
          getCameraNames(),
          getTimeFormat(),
        ]);

      if (platesResult.data) {
        setData(platesResult.data);
        setTotal(platesResult.pagination.total);
      }

      if (tagsResult.success) {
        setAvailableTags(tagsResult.data);
      }

      if (camerasResult.success) {
        setAvailableCameras(camerasResult.data);
      }

      setTimeFormat(timeFormatResult);
    } catch (error) {
      console.error("Error loading initial data:", error);
    }
    setLoading(false);
  };

  // Initial load effect
  useEffect(() => {
    loadInitialData();
  }, [
    page,
    pageSize,
    search,
    fuzzySearch,
    tag,
    dateFrom,
    dateTo,
    hourFrom,
    hourTo,
    cameraName,
  ]);

  // SSE subscription effect
  useEffect(() => {
    console.log("Setting up SSE connection...");
    const eventSource = new EventSource("/api/SSE/plates");

    eventSource.onmessage = async (event) => {
      console.log("Received SSE event:", event.data);
      const data = JSON.parse(event.data);
      if (data.type === "new-plate") {
        console.log("New plate detected, checking if reload needed...");
        // Only reload if we're on the first page and have no filters
        if (
          page === "1" &&
          !search &&
          tag === "all" &&
          !dateFrom &&
          !dateTo &&
          !hourFrom &&
          !hourTo &&
          !cameraName
        ) {
          console.log("Reloading data...");
          await loadInitialData();
        }
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE Error:", error);
      eventSource.close();
    };

    eventSource.onopen = () => {
      console.log("SSE connection established");
    };

    return () => {
      console.log("Cleaning up SSE connection...");
      eventSource.close();
    };
  }, [page, search, tag, dateFrom, dateTo, hourFrom, hourTo, cameraName]);

  // Rest of your existing functions
  const createQueryString = useCallback(
    (params) => {
      const current = new URLSearchParams(Array.from(searchParams.entries()));
      Object.entries(params).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          current.delete(key);
        } else {
          current.set(key, value);
        }
      });
      return current.toString();
    },
    [searchParams]
  );

  const handleAddTag = async (plateNumber, tagName) => {
    const formData = new FormData();
    formData.append("plateNumber", plateNumber);
    formData.append("tagName", tagName);

    const result = await tagPlate(formData);
    if (result.success) {
      setData((prevData) =>
        prevData.map((plate) => {
          if (plate.plate_number === plateNumber) {
            const newTag = availableTags.find((t) => t.name === tagName);
            return {
              ...plate,
              tags: [...(plate.tags || []), newTag],
            };
          }
          return plate;
        })
      );
    }
  };

  const handleRemoveTag = async (plateNumber, tagName) => {
    const formData = new FormData();
    formData.append("plateNumber", plateNumber);
    formData.append("tagName", tagName);

    const result = await untagPlate(formData);
    if (result.success) {
      setData((prevData) =>
        prevData.map((plate) => {
          if (plate.plate_number === plateNumber) {
            return {
              ...plate,
              tags: (plate.tags || []).filter((tag) => tag.name !== tagName),
            };
          }
          return plate;
        })
      );
    }
  };

  const handleAddKnownPlate = async (plateNumber, name, notes) => {
    const formData = new FormData();
    formData.append("plateNumber", plateNumber);
    formData.append("name", name);
    formData.append("notes", notes);

    const result = await addKnownPlate(formData);
    if (result.success) {
      setData((prevData) =>
        prevData.map((plate) =>
          plate.plate_number === plateNumber
            ? { ...plate, known_name: name, known_notes: notes }
            : plate
        )
      );
    }
  };

  const handleDeleteRecord = async (plateNumber) => {
    const formData = new FormData();
    formData.append("plateNumber", plateNumber);

    const result = await deletePlateRead(formData);
    if (result.success) {
      setData((prevData) =>
        prevData.filter((plate) => plate.plate_number !== plateNumber)
      );
      setTotal((prev) => prev - 1);
    }
  };

  const handlePageChange = useCallback(
    (direction) => {
      const currentPage = parseInt(page);
      const newPage = direction === "next" ? currentPage + 1 : currentPage - 1;

      if (
        newPage < 1 ||
        (direction === "next" && currentPage * parseInt(pageSize) >= total)
      ) {
        return;
      }

      const queryString = createQueryString({ page: newPage.toString() });
      router.push(`${pathname}?${queryString}`);
    },
    [page, pageSize, total, router, pathname, createQueryString]
  );

  const updateFilters = useCallback(
    (newParams) => {
      if ("page" in newParams) return;

      const queryString = createQueryString({
        ...Object.fromEntries(searchParams.entries()),
        ...newParams,
      });
      router.push(`${pathname}?${queryString}`);
    },
    [router, pathname, searchParams, createQueryString]
  );

  const handleCorrectPlate = async (formData) => {
    const result = await correctPlateRead(formData);
    if (result.success) {
      const readId = formData.get("readId");
      const newPlateNumber = formData.get("newPlateNumber");
      const correctAll = formData.get("correctAll") === "true";

      if (correctAll) {
        // If correcting all instances, reload the entire dataset
        const platesResult = await getLatestPlateReads({
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          search,
          fuzzySearch,
          tag,
          dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null,
          cameraName,
        });

        if (platesResult.data) {
          setData(platesResult.data);
          setTotal(platesResult.pagination.total);
        }
      } else {
        // If correcting single instance, update optimistically
        setData((prevData) =>
          prevData.map((plate) =>
            plate.id === parseInt(readId)
              ? { ...plate, plate_number: newPlateNumber }
              : plate
          )
        );
      }
    }
    return result;
  };

  return (
    <PlateTable
      data={data}
      loading={loading}
      availableTags={availableTags}
      availableCameras={availableCameras}
      timeFormat={timeFormat}
      pagination={{
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total,
        onNextPage: () => handlePageChange("next"),
        onPreviousPage: () => handlePageChange("prev"),
      }}
      filters={{
        search,
        fuzzySearch,
        tag,
        dateRange: {
          from: dateFrom ? new Date(dateFrom) : null,
          to: dateTo ? new Date(dateTo) : null,
        },
        hourRange:
          hourFrom && hourTo
            ? {
                from: parseInt(hourFrom),
                to: parseInt(hourTo),
              }
            : null,
        cameraName,
      }}
      onUpdateFilters={updateFilters}
      onAddTag={handleAddTag}
      onRemoveTag={handleRemoveTag}
      onAddKnownPlate={handleAddKnownPlate}
      onDeleteRecord={handleDeleteRecord}
      onCorrectPlate={handleCorrectPlate}
    />
  );
}
