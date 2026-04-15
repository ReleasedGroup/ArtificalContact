import type { SearchType } from '../lib/search'
import { SearchScreen } from './SearchScreen'

interface SearchResultsScreenProps {
  initialQuery: string
  initialType: SearchType
}

export function SearchResultsScreen(props: SearchResultsScreenProps) {
  void props.initialQuery
  void props.initialType
  return <SearchScreen />
}
