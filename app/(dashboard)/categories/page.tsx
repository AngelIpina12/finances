"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Pencil, Trash2, Tag as TagIcon, ChevronDown, ChevronRight, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { z } from "zod";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSubcategories,
} from "@/server/actions/category-actions";
import { createTag, deleteTag, getTagsByCategory } from "@/server/actions/tag-actions";
import type { Category, Tag } from "@/lib/db/schema";

const categoryFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  type: z.enum(["income", "expense"]),
  iconUrl: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().optional(),
});

const tagFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  categoryId: z.string(),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;
type TagFormData = z.infer<typeof tagFormSchema>;

type TabType = "all" | "income" | "expense";

interface CategoryWithSubs extends Category {
  subcategories: Category[];
}

const TYPE_COLORS: Record<string, string> = {
  income: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  expense: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryWithSubs[]>([]);
  const [tags, setTags] = useState<Record<string, Tag[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [modalStep, setModalStep] = useState<"type" | "form">("type");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Subcategory modal state
  const [isSubcategoryModalOpen, setIsSubcategoryModalOpen] = useState(false);
  const [editingSubcategoryId, setEditingSubcategoryId] = useState<string | null>(null);
  const [parentCategoryId, setParentCategoryId] = useState<string | null>(null);

  // Tag modal state
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagCategoryId, setTagCategoryId] = useState<string | null>(null);

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      type: "expense",
      iconUrl: "",
      color: "#3B82F6",
      parentId: undefined,
    },
  });

  const tagForm = useForm<TagFormData>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: {
      name: "",
      categoryId: "",
    },
  });

  async function fetchCategories() {
    try {
      setIsLoading(true);
      const data = await getCategories();

      // Group categories with their subcategories
      const parentCategories = data.filter((c) => !c.parentId);
      const categoriesWithSubs: CategoryWithSubs[] = await Promise.all(
        parentCategories.map(async (cat) => {
          const subs = await getSubcategories(cat.id);
          const subsWithSubs: CategoryWithSubs[] = await Promise.all(
            subs.map(async (sub) => {
              const subSubs = await getSubcategories(sub.id);
              return { ...sub, subcategories: subSubs };
            })
          );
          return { ...cat, subcategories: subsWithSubs };
        })
      );

      setCategories(categoriesWithSubs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchTagsForCategory(categoryId: string) {
    try {
      const categoryTags = await getTagsByCategory(categoryId);
      setTags((prev) => ({ ...prev, [categoryId]: categoryTags }));
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    // Fetch tags for all categories
    categories.forEach((cat) => {
      fetchTagsForCategory(cat.id);
      cat.subcategories.forEach((sub) => {
        fetchTagsForCategory(sub.id);
      });
    });
  }, [categories]);

  async function handleDelete() {
    if (!deleteCategoryId) return;
    try {
      await deleteCategory(deleteCategoryId);
      setDeleteCategoryId(null);
      await fetchCategories();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete category");
    }
  }

  function openCreateModal() {
    setIsEditMode(false);
    setEditingCategory(null);
    setModalStep("type");
    form.reset({
      name: "",
      type: "expense",
      iconUrl: "",
      color: "#3B82F6",
      parentId: undefined,
    });
    setIsModalOpen(true);
  }

  async function openEditModal(category: Category) {
    setIsEditMode(true);
    setEditingCategory(category);
    setIsModalOpen(true);

    form.reset({
      name: category.name,
      type: category.type as "income" | "expense",
      iconUrl: category.iconUrl || "",
      color: category.color || "#3B82F6",
      parentId: category.parentId || undefined,
    });
    setModalStep("form");
  }

  function closeModal() {
    setIsModalOpen(false);
    setIsEditMode(false);
    setEditingCategory(null);
    setModalStep("type");
    setError(null);
  }

  async function onSubmit(data: CategoryFormData) {
    try {
      setIsSubmitting(true);
      setError(null);

      if (isEditMode && editingCategory) {
        await updateCategory(editingCategory.id, {
          name: data.name,
          iconUrl: data.iconUrl,
          color: data.color,
          parentId: data.parentId,
        });
      } else {
        await createCategory({
          name: data.name,
          type: data.type,
          iconUrl: data.iconUrl,
          color: data.color,
          parentId: data.parentId,
        });
      }

      closeModal();
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving category");
      setIsSubmitting(false);
    }
  }

  function handleTypeSelect(type: "income" | "expense") {
    form.setValue("type", type);
    setModalStep("form");
  }

  function toggleExpanded(categoryId: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  // Subcategory functions
  function openSubcategoryModal(parentId: string) {
    setParentCategoryId(parentId);
    setEditingSubcategoryId(null);
    tagForm.reset({ name: "", categoryId: parentId });
    setIsSubcategoryModalOpen(true);
  }

  async function handleSubcategorySubmit(data: TagFormData) {
    try {
      setIsSubmitting(true);
      await createTag({ name: data.name, categoryId: data.categoryId });
      setIsSubcategoryModalOpen(false);
      await fetchCategories();
      // Refresh tags for this category
      await fetchTagsForCategory(data.categoryId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create subcategory");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteSubcategory(tagId: string, categoryId: string) {
    try {
      await deleteTag(tagId);
      await fetchCategories();
      await fetchTagsForCategory(categoryId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete subcategory");
    }
  }

  // Tag functions
  function openTagModal(categoryId: string) {
    setTagCategoryId(categoryId);
    setEditingTagId(null);
    tagForm.reset({ name: "", categoryId });
    setIsTagModalOpen(true);
  }

  async function handleTagSubmit(data: TagFormData) {
    try {
      setIsSubmitting(true);
      await createTag({ name: data.name, categoryId: data.categoryId });
      setIsTagModalOpen(false);
      await fetchTagsForCategory(data.categoryId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create tag");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTag(tagId: string, categoryId: string) {
    try {
      await deleteTag(tagId);
      await fetchTagsForCategory(categoryId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete tag");
    }
  }

  const watchedType = form.watch("type");

  const filteredCategories = categories.filter((cat) => {
    if (activeTab === "all") return true;
    return cat.type === activeTab;
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Categorías</h1>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Categoría
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(["all", "income", "expense"] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors relative",
              activeTab === tab
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "all" ? "Todas" : tab === "income" ? "Ingresos" : "Egresos"}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Category Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? "Editar Categoría" : modalStep === "type" ? "Crear Categoría" : "Crear Categoría"}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Actualiza los datos de tu categoría."
                : modalStep === "type"
                ? "Selecciona el tipo de categoría que deseas crear."
                : `Creando categoría de ${watchedType === "income" ? "ingreso" : "egreso"}`}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-500 dark:bg-red-900/20">
              {error}
            </div>
          )}

          {modalStep === "type" && !isEditMode ? (
            <div className="grid grid-cols-2 gap-4 py-4">
              <button
                type="button"
                onClick={() => handleTypeSelect("income")}
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
              >
                <span className="text-2xl mb-2">📈</span>
                <span className="font-medium">Ingreso</span>
              </button>
              <button
                type="button"
                onClick={() => handleTypeSelect("expense")}
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <span className="text-2xl mb-2">📉</span>
                <span className="font-medium">Egreso</span>
              </button>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Tipo (solo mostrar en editar, no editable) */}
              <div className="space-y-2">
                <Label>Tipo</Label>
                <div className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium w-fit",
                  TYPE_COLORS[watchedType]
                )}>
                  {watchedType === "income" ? "Ingreso" : "Egreso"}
                </div>
                {isEditMode && (
                  <p className="text-xs text-muted-foreground">
                    El tipo no se puede cambiar después de crear.
                  </p>
                )}
              </div>

              {/* Nombre */}
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  placeholder="e.g., Comida, Transporte"
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              {/* Color */}
              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    {...form.register("color")}
                    className="h-10 w-14 rounded border cursor-pointer"
                  />
                  <Input
                    id="color"
                    placeholder="#3B82F6"
                    {...form.register("color")}
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Ícono */}
              <div className="space-y-2">
                <Label htmlFor="iconUrl">URL del Ícono (Opcional)</Label>
                <Input
                  id="iconUrl"
                  placeholder="https://res.cloudinary.com/..."
                  {...form.register("iconUrl")}
                />
                <p className="text-xs text-muted-foreground">
                  Sube tu imagen a Cloudinary y pega la URL aquí.
                </p>
              </div>

              <div className="flex justify-between pt-4">
                {!isEditMode && modalStep === "form" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalStep("type")}
                    disabled={isSubmitting}
                  >
                    Atrás
                  </Button>
                )}
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditMode ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Subcategory/Tag Modal */}
      <Dialog open={isSubcategoryModalOpen} onOpenChange={setIsSubcategoryModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Agregar Subcategoría</DialogTitle>
            <DialogDescription>
              Agrega una subcategoría a esta categoría.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={tagForm.handleSubmit(handleSubcategorySubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                placeholder="e.g., Restaurantes, Fast Food"
                {...tagForm.register("name")}
              />
              {tagForm.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {tagForm.formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSubcategoryModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tags Modal */}
      <Dialog open={isTagModalOpen} onOpenChange={setIsTagModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Agregar Etiqueta</DialogTitle>
            <DialogDescription>
              Agrega etiquetas para esta categoría. Las etiquetas son específicas de cada categoría.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={tagForm.handleSubmit(handleTagSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                placeholder="e.g., Trabajo, Personal"
                {...tagForm.register("name")}
              />
              {tagForm.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {tagForm.formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsTagModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Categories Grid */}
      {filteredCategories.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TagIcon className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">No hay categorías</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Crea tu primera categoría para organizar tus transacciones.
            </p>
            <Button onClick={openCreateModal}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar Categoría
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCategories.map((category) => (
            <Card key={category.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Category Icon */}
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: category.color || "#3B82F6" }}
                    >
                      {category.iconUrl ? (
                        <img
                          src={category.iconUrl}
                          alt={category.name}
                          className="h-6 w-6 object-contain"
                        />
                      ) : (
                        <span className="text-lg">
                          {category.type === "income" ? "📈" : "📉"}
                        </span>
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base">{category.name}</CardTitle>
                      <Badge variant="secondary" className="text-xs mt-1">
                        {category.type === "income" ? "Ingreso" : "Egreso"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {category.subcategories.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpanded(category.id)}
                      >
                        {expandedCategories.has(category.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openSubcategoryModal(category.id)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditModal(category)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteCategoryId(category.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Eliminar Categoría</AlertDialogTitle>
                          <AlertDialogDescription>
                            ¿Estás seguro de eliminar &quot;{category.name}&quot;?
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-red-500 hover:bg-red-600"
                          >
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Subcategories */}
                {expandedCategories.has(category.id) && category.subcategories.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-xs text-muted-foreground font-medium">Subcategorías:</p>
                    <div className="flex flex-wrap gap-1">
                      {category.subcategories.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-sm"
                        >
                          <span>{sub.name}</span>
                          <button
                            onClick={() => handleDeleteSubcategory(sub.id, category.id)}
                            className="text-muted-foreground hover:text-red-500"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {tags[category.id] && tags[category.id].length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground font-medium">Etiquetas:</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => openTagModal(category.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Agregar
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tags[category.id].map((tag) => (
                        <div
                          key={tag.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground text-xs"
                        >
                          <span>{tag.name}</span>
                          <button
                            onClick={() => handleDeleteTag(tag.id, category.id)}
                            className="hover:text-red-500"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(!tags[category.id] || tags[category.id].length === 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => openTagModal(category.id)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar Etiquetas
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
