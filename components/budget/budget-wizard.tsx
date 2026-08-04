"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { budgetSchema, type BudgetInput } from "@/types/forms";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { BasicInfoStep } from "./steps/basic-info-step";
import { HierarchyStep } from "./steps/hierarchy-step";
import { CreditCardStep } from "./steps/credit-card-step";
import { CategoriesStep } from "./steps/categories-step";
import { ReviewStep } from "./steps/review-step";
import { createBudget, updateBudget } from "@/server/actions/budget-actions";

type WizardStep = "basic" | "hierarchy" | "creditCards" | "categories" | "review";

const STEPS: WizardStep[] = ["basic", "hierarchy", "creditCards", "categories", "review"];

interface BudgetWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  initialData?: Partial<BudgetInput>;
  editingBudgetId?: string;
}

export function BudgetWizard({
  onComplete,
  onCancel,
  initialData,
  editingBudgetId,
}: BudgetWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("basic");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(budgetSchema) as any,
    defaultValues: {
      name: initialData?.name || "",
      amount: initialData?.amount || "0",
      period: initialData?.period || "monthly",
      type: initialData?.type || "expense",
      isGlobal: initialData?.isGlobal ?? true,
      isReusable: initialData?.isReusable ?? false,
      rolloverType: initialData?.rolloverType || "disabled",
      categoryId: initialData?.categoryId || undefined,
      startDate: initialData?.startDate || new Date(),
      endDate: initialData?.endDate || undefined,
      allocations: initialData?.allocations || [],
      autoCalculateAllocations: initialData?.autoCalculateAllocations ?? false,
      hasCreditCardTracking: initialData?.hasCreditCardTracking ?? false,
      ccAccounts: initialData?.ccAccounts || [],
    },
  });

  const currentStepIndex = STEPS.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;
  const isGlobal = form.watch("isGlobal");
  const hasCCTracking = form.watch("hasCreditCardTracking");

  const goForward = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      const nextStep = STEPS[idx + 1];
      // Skip categories step if global
      if (nextStep === "categories" && isGlobal) {
        setCurrentStep("review");
      // Skip creditCards step if CC tracking is disabled
      } else if (nextStep === "creditCards" && !hasCCTracking) {
        setCurrentStep("categories");
      } else {
        setCurrentStep(nextStep);
      }
    }
  };

  const goBack = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) {
      const prevStep = STEPS[idx - 1];
      // Skip categories step if global
      if (prevStep === "categories" && isGlobal) {
        setCurrentStep("basic");
      // Skip creditCards step if CC tracking is disabled
      } else if (prevStep === "creditCards" && !hasCCTracking) {
        setCurrentStep("basic");
      } else {
        setCurrentStep(prevStep);
      }
    }
  };

  const onSubmit = async (data: any) => {
    try {
      setIsSubmitting(true);
      // Calculate amount from allocations if not global
      if (!data.isGlobal && data.allocations?.length > 0) {
        data.amount = data.allocations
          .reduce((sum: number, a: any) => sum + (parseFloat(a.amount) || 0), 0)
          .toString();
      }
      if (editingBudgetId) {
        await updateBudget(editingBudgetId, data);
      } else {
        await createBudget(data);
      }
      onComplete();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case "basic":
        return <BasicInfoStep form={form} />;
      case "hierarchy":
        return <HierarchyStep form={form} />;
      case "creditCards":
        return <CreditCardStep form={form} />;
      case "categories":
        return <CategoriesStep form={form} />;
      case "review":
        return <ReviewStep form={form} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <Progress value={progress} className="h-2" />

      <div className="min-h-[300px]">{renderStep()}</div>

      <div className="flex justify-between pt-4 border-t">
        <Button
          variant="outline"
          onClick={currentStepIndex === 0 ? onCancel : goBack}
          disabled={isSubmitting}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {currentStepIndex === 0 ? "Cancel" : "Back"}
        </Button>

        {currentStep === "review" ? (
          <Button onClick={form.handleSubmit(onSubmit)} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Check className="mr-2 h-4 w-4" />
            {editingBudgetId ? "Update Budget" : "Create Budget"}
          </Button>
        ) : (
          <Button onClick={goForward}>
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
