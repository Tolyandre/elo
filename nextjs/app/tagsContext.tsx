"use client"

import { createContext, useContext, ReactNode } from "react";
import { Tag, listTagsPromise } from "./api";
import { useAsyncResource } from "@/hooks/useAsyncResource";

type TagsContextType = {
  tags: Tag[];
  invalidate: () => void;
};

const TagsContext = createContext<TagsContextType | undefined>(undefined);

export const TagsProvider = ({ children }: { children: ReactNode }) => {
  const { data, invalidate } = useAsyncResource(listTagsPromise);
  const tags = data ?? [];

  return (
    <TagsContext.Provider value={{ tags, invalidate }}>
      {children}
    </TagsContext.Provider>
  );
};

export const useTags = () => {
  const ctx = useContext(TagsContext);
  if (!ctx) {
    throw new Error("useTags must be used within a TagsProvider");
  }
  return ctx;
};
