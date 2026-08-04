"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, RefreshCw } from "lucide-react";
import { format, addDays, addWeeks, addMonths, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";

export type Granularity = "day" | "week" | "month";

interface ProjectionControlsProps {
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  // CC projection months ahead (1-6)
  monthsAhead?: number;
  onMonthsAheadChange?: (months: number) => void;
}

const GRANULARITY_OPTIONS = [
  { value: "day" as const, label: "Daily", description: "Show each day" },
  { value: "week" as const, label: "Weekly", description: "Show each week" },
  { value: "month" as const, label: "Monthly", description: "Show each month" },
];

export function ProjectionControls({
  granularity,
  onGranularityChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRefresh,
  isLoading,
  monthsAhead = 3,
  onMonthsAheadChange,
}: ProjectionControlsProps) {
  const [startPopoverOpen, setStartPopoverOpen] = useState(false);
  const [endPopoverOpen, setEndPopoverOpen] = useState(false);

  const setQuickRange = (range: "1w" | "1m" | "3m" | "6m" | "1y") => {
    const today = startOfDay(new Date());
    switch (range) {
      case "1w":
        onStartDateChange(addDays(today, -7));
        onEndDateChange(today);
        break;
      case "1m":
        onStartDateChange(addMonths(today, -1));
        onEndDateChange(today);
        break;
      case "3m":
        onStartDateChange(addMonths(today, -3));
        onEndDateChange(today);
        break;
      case "6m":
        onStartDateChange(addMonths(today, -6));
        onEndDateChange(today);
        break;
      case "1y":
        onStartDateChange(addMonths(today, -12));
        onEndDateChange(today);
        break;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* Granularity */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Granularity</Label>
          <Select
            value={granularity}
            onValueChange={(v) => onGranularityChange(v as Granularity)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANULARITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Start Date */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Start Date</Label>
          <Popover open={startPopoverOpen} onOpenChange={setStartPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[180px] justify-start text-left font-normal",
                  !startDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={(date) => {
                  if (date) {
                    onStartDateChange(date);
                    setStartPopoverOpen(false);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* End Date */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">End Date</Label>
          <Popover open={endPopoverOpen} onOpenChange={setEndPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[180px] justify-start text-left font-normal",
                  !endDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={(date) => {
                  if (date) {
                    onEndDateChange(date);
                    setEndPopoverOpen(false);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Refresh Button */}
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw
            className={cn("h-4 w-4", isLoading && "animate-spin")}
          />
        </Button>
      </div>

      {/* Quick Ranges */}
      <div className="flex gap-2">
        <span className="text-xs text-muted-foreground self-center">Quick:</span>
        {[
          { key: "1w", label: "1 Week" },
          { key: "1m", label: "1 Month" },
          { key: "3m", label: "3 Months" },
          { key: "6m", label: "6 Months" },
          { key: "1y", label: "1 Year" },
        ].map((range) => (
          <Button
            key={range.key}
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setQuickRange(range.key as "1w" | "1m" | "3m" | "6m" | "1y")}
          >
            {range.label}
          </Button>
        ))}
      </div>

      {/* CC Projection Months Ahead */}
      {onMonthsAheadChange && (
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">Project CC Debt:</span>
          {[1, 2, 3, 4, 5, 6].map((m) => (
            <Button
              key={m}
              variant={monthsAhead === m ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onMonthsAheadChange(m)}
            >
              {m}mo
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
